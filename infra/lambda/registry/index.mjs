// registry-fn — tool CRUD with immutable versioning.
//
// Invariant #5: a version is never edited. Re-registering a tool_id writes a NEW
// sort-key row; the previous row is byte-identical afterwards, so dependents
// keep resolving to exactly what they were built against.
//
// Two things enforce that together, and both are needed:
//   - IAM denies UpdateItem / DeleteItem / BatchWriteItem on the tools table
//   - the ConditionExpression below, because PutItem CAN overwrite a same-key
//     item and no IAM Deny prevents that

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  BedrockRuntimeClient, InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { packVector } from "./vector.mjs";
import { authenticate, authorise } from "./auth.mjs";
import { validateUses } from "./deps.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({});

const TOOLS = process.env.TOOLS_TABLE;
const CALLERS = process.env.CALLERS_TABLE;
const PUBLISH_COST = Number(process.env.PUBLISH_COST_CREDITS ?? 0);
const MODEL = process.env.EMBED_MODEL_ID;
const DIMS = Number(process.env.EMBED_DIMS || 1024);

const json = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

// One embedding path, shared by registry and search. Different preprocessing on
// the two sides is a silent and very common recall killer.
export async function embed(text) {
  const res = await bedrock.send(new InvokeModelCommand({
    modelId: MODEL,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({ inputText: text, dimensions: DIMS, normalize: true }),
  }));
  const parsed = JSON.parse(new TextDecoder().decode(res.body));
  return { vector: parsed.embedding, tokens: parsed.inputTextTokenCount ?? 0 };
}

const lookupCaller = async (callerId) => {
  const out = await ddb.send(new GetCommand({
    TableName: CALLERS, Key: { caller_id: callerId },
  }));
  return out.Item ?? null;
};

// Charging for publication, not for calls.
//
// The cost belongs where supply enters the world: a tool version is an
// embedding, a review and a permanent row, and a fee there makes flooding the
// registry expensive while leaving questions free to ask. Charging per call
// would have suppressed the gap signal the registry exists to collect.
//
// DEBIT FIRST, refund on failure. The alternative — publish, then charge — has
// a failure mode where the charge fails after a successful write and the
// publication is silently free. This ordering's failure mode is a caller
// briefly out of pocket for a publication that did not happen, which is
// recoverable and, unlike the other, visible.
//
// The condition is what makes concurrency safe: two simultaneous publishes on a
// balance of one cannot both succeed, because the second one's condition fails
// against the already-decremented value.
async function debit(callerId, cost) {
  if (cost <= 0) return { ok: true, charged: 0 };
  try {
    const out = await ddb.send(new UpdateCommand({
      TableName: CALLERS,
      Key: { caller_id: callerId },
      UpdateExpression: "SET credits = credits - :c, publications = if_not_exists(publications, :z) + :one",
      ConditionExpression: "credits >= :c",
      ExpressionAttributeValues: { ":c": cost, ":one": 1, ":z": 0 },
      ReturnValues: "UPDATED_NEW",
    }));
    return { ok: true, charged: cost, credits_after: out.Attributes?.credits ?? null };
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") return { ok: false };
    throw err;
  }
}

async function refund(callerId, cost, why) {
  if (cost <= 0) return;
  try {
    await ddb.send(new UpdateCommand({
      TableName: CALLERS,
      Key: { caller_id: callerId },
      UpdateExpression: "SET credits = credits + :c, publications = publications - :one",
      ExpressionAttributeValues: { ":c": cost, ":one": 1 },
    }));
    console.log(JSON.stringify({ metric: "publish_refund", caller_id: callerId, cost, why }));
  } catch (err) {
    // Loud, because the caller has paid for nothing and only the log knows.
    console.error(JSON.stringify({
      metric: "publish_refund_failed", caller_id: callerId, cost, why,
      message: String(err.message).slice(0, 200),
    }));
  }
}

const pad = (n) => String(n).padStart(4, "0");

async function latestRow(toolId) {
  const out = await ddb.send(new QueryCommand({
    TableName: TOOLS,
    KeyConditionExpression: "tool_id = :t",
    ExpressionAttributeValues: { ":t": toolId },
    ScanIndexForward: false,
    Limit: 1,
  }));
  return out.Items?.[0] ?? null;
}

async function register(body, caller) {
  const required = ["tool_id", "name", "description"];
  for (const f of required) {
    if (!body?.[f]) return json(400, { error: `missing field: ${f}` });
  }

  // Ownership is taken from the verified caller, never from the request.
  //
  // It used to come from body.owner, which meant anyone publishing could name
  // anyone as the owner. Ownership decides bounty eligibility, self-call
  // exclusion and takedown authority, so a forgeable owner field made all three
  // meaningless. Rejected rather than ignored: silently dropping a field a
  // caller set is how someone builds on a misunderstanding.
  if (body.owner !== undefined && body.owner !== caller.owner) {
    return json(403, { error: "owner is taken from the authenticated caller and cannot be set in the request" });
  }
  const owner = caller.owner ?? caller.caller_id;

  const { vector, tokens } = await embed(body.description);
  const previous = await latestRow(body.tool_id);
  const version = pad(previous ? Number(previous.version) + 1 : 1);

  // The executable package is stored ON the version row, so the code that runs
  // and the version that was reviewed are the same immutable object. There is no
  // way to swap a handler after approval without minting a new version.
  const pkg = body.package ?? null;
  if (pkg) {
    if (typeof pkg.handler_source !== "string" || !pkg.handler_source.length) {
      return json(400, { error: "package.handler_source must be a non-empty string" });
    }
    if (pkg.handler_source.length > 256 * 1024) {
      return json(400, { error: "package.handler_source exceeds 256 KB" });
    }
    // Every tool this one depends on, fixed at registration for the same reason
    // as the host allowlist: a dependency that could be chosen at call time
    // would not be part of what review looked at.
    const useErrors = validateUses(pkg.uses, body.tool_id);
    if (useErrors.length) return json(400, { error: useErrors.join("; ") });

    // Every host a tool may reach, fixed at registration. The fetcher re-checks
    // at call time, but recording it here is what makes review meaningful.
    for (const req of pkg.requests ?? []) {
      let host;
      try { host = new URL(String(req.url).replace(/\{\w+\}/g, "x")).host; }
      catch { return json(400, { error: `request ${req.id}: url is not parseable` }); }
      if (!(pkg.allowlist ?? []).includes(host)) {
        return json(400, { error: `request ${req.id}: host ${host} is not in the declared allowlist` });
      }
    }
  }

  const item = {
    tool_id: body.tool_id,
    version,
    name: body.name,
    description: body.description,
    mcp_url: body.mcp_url ?? null,
    category: body.category ?? "uncategorised",
    owner,
    // Ownership was taken from the authenticated caller, so it can be trusted.
    // Rows written before identity was enforced carry no such flag, and
    // anything that reasons about ownership must treat those as unverified —
    // see mass.mjs. The 20 tools seeded in Phase 0 are exactly that case.
    owner_verified: true,
    source_api: body.source_api ?? null,
    vec_b64: packVector(vector),
    vec_dims: vector.length,
    embed_model: MODEL,
    created_at: new Date().toISOString(),
    ...(pkg ? {
      handler_source: pkg.handler_source,
      requests: pkg.requests ?? [],
      allowlist: pkg.allowlist ?? [],
      uses: pkg.uses ?? [],
      input_schema: pkg.input ?? {},
      runtime: pkg.runtime ?? "lambda-vpc",
      executable: true,
    } : { executable: false }),
  };

  const paid = await debit(caller.caller_id, PUBLISH_COST);
  if (!paid.ok) {
    // 402 rather than 403: a billing state the caller can act on, not a
    // permissions one, and they should be able to tell without reading prose.
    return json(402, { error: `publishing costs ${PUBLISH_COST} credits and the balance is short` });
  }

  try {
    await ddb.send(new PutCommand({
      TableName: TOOLS,
      Item: item,
      ConditionExpression:
        "attribute_not_exists(tool_id) AND attribute_not_exists(#v)",
      ExpressionAttributeNames: { "#v": "version" },
    }));
  } catch (err) {
    await refund(caller.caller_id, paid.charged, err.name);
    if (err.name === "ConditionalCheckFailedException") {
      return json(409, {
        error: "version already exists — versions are immutable",
        tool_id: body.tool_id,
        version,
      });
    }
    throw err;
  }

  // The only line item that costs money, so it is measured rather than estimated.
  console.log(JSON.stringify({
    metric: "embed_tokens", tokens, op: "register", tool_id: body.tool_id,
  }));

  return json(201, {
    tool_id: body.tool_id, version, ref: `${body.tool_id}@${version}`, owner,
    charged: paid.charged, credits_remaining: paid.credits_after,
  });
}

export const handler = async (event) => {
  const method = event?.requestContext?.http?.method ?? "GET";
  const path = event?.rawPath ?? "/";
  const raw = event?.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf8")
    : event?.body;

  try {
    // Reads are authenticated too, not only writes. The registry is the supply
    // side of the marketplace; who is enumerating it is worth knowing, and one
    // rule for the whole surface is easier to reason about than two.
    const auth = await authenticate(event?.headers, lookupCaller);
    if (!auth.ok) return json(auth.status, { error: auth.error });

    if (method === "POST" && path.startsWith("/tools")) {
      // Balance checked before the embedding, so a caller who cannot afford to
      // publish is turned away for the price of one GetItem rather than a
      // Bedrock call. The debit inside register() re-checks under a condition;
      // this one is only there to avoid the spend.
      const allowed = authorise(auth.caller, PUBLISH_COST);
      if (!allowed.ok) return json(allowed.status, { error: allowed.error });
      return await register(raw ? JSON.parse(raw) : {}, auth.caller);
    }

    if (auth.caller.status !== "active") {
      return json(403, { error: `caller is ${auth.caller.status}` });
    }

    if (method === "GET") {
      const parts = path.split("/").filter(Boolean); // ["tools", id, version?]
      if (parts[0] !== "tools" || !parts[1]) {
        return json(400, { error: "use GET /tools/{id} or /tools/{id}/{version}" });
      }
      if (parts[2]) {
        const out = await ddb.send(new GetCommand({
          TableName: TOOLS,
          Key: { tool_id: parts[1], version: parts[2] },
        }));
        return out.Item ? json(200, out.Item) : json(404, { error: "not found" });
      }
      const row = await latestRow(parts[1]);
      return row ? json(200, row) : json(404, { error: "not found" });
    }

    return json(405, { error: `unsupported: ${method} ${path}` });
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message });
  }
};
