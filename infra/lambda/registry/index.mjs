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
  DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  BedrockRuntimeClient, InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { packVector } from "./vector.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({});

const TOOLS = process.env.TOOLS_TABLE;
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

async function register(body) {
  const required = ["tool_id", "name", "description"];
  for (const f of required) {
    if (!body?.[f]) return json(400, { error: `missing field: ${f}` });
  }

  const { vector, tokens } = await embed(body.description);
  const previous = await latestRow(body.tool_id);
  const version = pad(previous ? Number(previous.version) + 1 : 1);

  const item = {
    tool_id: body.tool_id,
    version,
    name: body.name,
    description: body.description,
    mcp_url: body.mcp_url ?? null,
    category: body.category ?? "uncategorised",
    owner: body.owner ?? "platform",
    source_api: body.source_api ?? null,
    vec_b64: packVector(vector),
    vec_dims: vector.length,
    embed_model: MODEL,
    created_at: new Date().toISOString(),
  };

  try {
    await ddb.send(new PutCommand({
      TableName: TOOLS,
      Item: item,
      ConditionExpression:
        "attribute_not_exists(tool_id) AND attribute_not_exists(#v)",
      ExpressionAttributeNames: { "#v": "version" },
    }));
  } catch (err) {
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

  return json(201, { tool_id: body.tool_id, version, ref: `${body.tool_id}@${version}` });
}

export const handler = async (event) => {
  const method = event?.requestContext?.http?.method ?? "GET";
  const path = event?.rawPath ?? "/";
  const raw = event?.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf8")
    : event?.body;

  try {
    if (method === "POST" && path.startsWith("/tools")) {
      return await register(raw ? JSON.parse(raw) : {});
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
