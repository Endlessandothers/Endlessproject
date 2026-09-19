// exec-fn — call a registered tool and record what happened.
//
// It owns the sequence and nothing else:
//
//   1. resolve the tool version from the registry
//   2. hand its declared requests to the fetcher, which is the only thing online
//   3. hand the responses to the runtime, which has no way to be online
//   4. append a call event, whatever the outcome
//
// The handler source lives on the tool row, so the code that runs and the
// version that was registered are the same immutable object. There is no path
// by which a tool executes code that differs from what review approved.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { randomUUID } from "node:crypto";
import { authenticate, provenanceOf, isSelfCall } from "./auth.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambda = new LambdaClient({});

const TOOLS = process.env.TOOLS_TABLE;
const EVENTS = process.env.EVENTS_TABLE;
const FETCHER_FN = process.env.FETCHER_FN;
const RUNTIME_FN = process.env.RUNTIME_FN;
const CALLERS = process.env.CALLERS_TABLE;

const json = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

// Not cached, for the reason given in infra/callers.tf: a suspended caller has
// to stop being able to run tools immediately, not eventually.
const lookupCaller = async (callerId) => {
  const out = await ddb.send(new GetCommand({
    TableName: CALLERS, Key: { caller_id: callerId },
  }));
  return out.Item ?? null;
};

async function invoke(fn, payload) {
  const res = await lambda.send(new InvokeCommand({
    FunctionName: fn,
    InvocationType: "RequestResponse",
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
  const text = Buffer.from(res.Payload ?? []).toString("utf8");
  if (res.FunctionError) throw new Error(`${fn} failed: ${text.slice(0, 200)}`);
  return JSON.parse(text || "{}");
}

async function resolveTool(toolId, version) {
  if (version) {
    const out = await ddb.send(new GetCommand({
      TableName: TOOLS, Key: { tool_id: toolId, version },
    }));
    return out.Item ?? null;
  }
  const out = await ddb.send(new QueryCommand({
    TableName: TOOLS,
    KeyConditionExpression: "tool_id = :t",
    ExpressionAttributeValues: { ":t": toolId },
    ScanIndexForward: false, Limit: 1,
  }));
  return out.Items?.[0] ?? null;
}

// Inputs are checked here rather than in the tool, because a tool that
// validates its own arguments is trusting code that has not been trusted yet.
function validateInput(schema = {}, input = {}) {
  const errors = [];
  for (const [key, spec] of Object.entries(schema)) {
    const present = key in input && input[key] !== null && input[key] !== "";
    if (spec.required && !present) { errors.push(`missing required input: ${key}`); continue; }
    if (!present) continue;
    const actual = typeof input[key];
    if (spec.type === "number" && actual !== "number") errors.push(`${key} must be a number`);
    if (spec.type === "string" && actual !== "string") errors.push(`${key} must be a string`);
  }
  for (const key of Object.keys(input)) {
    if (!(key in schema)) errors.push(`unknown input: ${key}`);
  }
  return errors;
}

async function recordEvent(fields) {
  const ts = new Date().toISOString();
  await ddb.send(new PutCommand({
    TableName: EVENTS,
    Item: { event_id: randomUUID(), ts, day: ts.slice(0, 10), type: "call", ...fields },
  }));
}

export const handler = async (event) => {
  const started = Date.now();
  const raw = event?.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf8")
    : event?.body;

  let body;
  try { body = raw ? JSON.parse(raw) : {}; }
  catch { return json(400, { error: "body is not valid json" }); }

  const { tool_id, version = null, input = {}, actor } = body;
  if (!tool_id) return json(400, { error: "missing field: tool_id" });

  // Invariant #4. actor names which of the caller's agents and sessions asked;
  // it is a self-declared sub-identity and stays unverified. The identity that
  // decisions are taken on is the authenticated caller below.
  if (!actor?.agent_id || !actor?.session_id) {
    return json(400, { error: "actor.agent_id and actor.session_id are required" });
  }

  // Before resolving the tool or invoking anything, so an unauthenticated
  // request costs one GetItem rather than a registry read and two Lambdas.
  const auth = await authenticate(event?.headers, lookupCaller);
  if (!auth.ok) return json(auth.status, { error: auth.error });
  if (auth.caller.status !== "active") {
    return json(403, { error: `caller is ${auth.caller.status}` });
  }

  // Calling a tool is free. Publishing one is not. See registry/index.mjs.
  const provenance = provenanceOf(auth.caller, actor);

  const fail = async (status, error, extra = {}) => {
    await recordEvent({
      tool_id, version, outcome: "error", error: String(error).slice(0, 300),
      ms: Date.now() - started, ...provenance, ...extra,
    });
    return json(status, { error });
  };

  try {
    const tool = await resolveTool(tool_id, version);
    if (!tool) return await fail(404, `no such tool: ${tool_id}${version ? `@${version}` : ""}`);
    if (!tool.handler_source) {
      return await fail(409, `${tool_id}@${tool.version} is registered but carries no executable package`);
    }

    const schemaErrors = validateInput(tool.input_schema, input);
    if (schemaErrors.length) return await fail(400, schemaErrors.join("; "), { version: tool.version });

    // Step 2 — the only component permitted to open a connection.
    const fetched = await invoke(FETCHER_FN, {
      tool_id, requests: tool.requests ?? [], input, allowlist: tool.allowlist ?? [],
    });
    if (!fetched.ok) {
      return await fail(502, `upstream fetch failed: ${fetched.error}`, { version: tool.version, stage: "fetch" });
    }

    // Step 3 — no route, no credentials, no disk.
    const ran = await invoke(RUNTIME_FN, {
      tool_id, version: tool.version, source: tool.handler_source,
      input, responses: fetched.responses,
    });
    if (!ran.ok) {
      return await fail(422, `tool failed: ${ran.error}`, { version: tool.version, stage: "transform" });
    }

    const ms = Date.now() - started;
    await recordEvent({
      tool_id, version: tool.version, outcome: "success", ms,
      transform_ms: ran.ms ?? null, ...provenance,
      // Flagged at write time, not inferred later: ownership on either side can
      // change, and the log has to stay true to the moment. A call by the tool's
      // own owner is not demand and must never count toward mass.
      self_call: isSelfCall(auth.caller, tool),
    });

    return json(200, {
      tool: `${tool_id}@${tool.version}`, result: ran.result, ms,
    });
  } catch (err) {
    console.error(err);
    return await fail(500, String(err?.message ?? err));
  }
};
