// exec-fn — call a registered tool and record what happened.
//
// It owns the sequence and nothing else:
//
//   1. resolve the tool version, and refuse it unless review approved it
//   2. run its declared tool dependencies first, recursively
//   3. hand its declared requests to the fetcher, the only thing online
//   4. hand both to the runtime, which has no way to be online
//   5. append a call event, whatever the outcome
//
// The handler source lives on the tool row, so the code that runs and the
// version that was registered are the same immutable object. There is no path
// by which a tool executes code that differs from what review approved.
//
// Step 2 is Phase 2, issue #1 — moons. A tool never calls another tool itself;
// it declares the dependency and the platform resolves it, exactly as it does
// for HTTP. See deps.mjs for why that is the only arrangement the sandbox
// permits, and for what bounds it.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { randomUUID } from "node:crypto";
import { authenticate, provenanceOf, isSelfCall } from "./auth.mjs";
import { mayExecute, refusalReason } from "./gate.mjs";
import { resolveInputs, checkChain } from "./deps.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambda = new LambdaClient({});

const TOOLS = process.env.TOOLS_TABLE;
const EVENTS = process.env.EVENTS_TABLE;
const FETCHER_FN = process.env.FETCHER_FN;
const RUNTIME_FN = process.env.RUNTIME_FN;
const CALLERS = process.env.CALLERS_TABLE;
const APPROVALS = process.env.APPROVALS_TABLE;

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

// The review gate.
//
// Publishing a tool and being allowed to RUN it are two different events.
// ABSENCE OF AN APPROVAL IS A REFUSAL: a version nobody has looked at does not
// execute, so the failure mode of a missing record, a failed write or a brand
// new tool is all the same safe one.
//
// Not cached, for the reason the callers table is not cached: a revoked tool
// has to stop running on the next call, and revocation that takes effect
// whenever a container recycles is not revocation.
async function approvalFor(toolId, version) {
  const out = await ddb.send(new GetCommand({
    TableName: APPROVALS, Key: { tool_id: toolId, version },
  }));
  return out.Item ?? null;
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

// One tool's execution, from resolving it to recording what happened.
//
// Recursive IN PROCESS rather than by invoking this function again. Lambda
// invoking itself is both something AWS actively detects and stops, and a way
// to turn one request into an unbounded fan-out of billable functions. Here the
// fan-out is bounded by MAX_DEPTH and MAX_USES and stays inside a single
// invocation, where its whole cost is visible in one place.
//
// chain is every tool already running above this one, which is what makes cycle
// detection possible; depth falls out of its length.
async function runTool({ toolId, version, input, provenance, chain, viaTool, rootCallId }) {
  const started = Date.now();

  const record = (fields) => recordEvent({
    tool_id: toolId, ...provenance,
    // The dependency edge, recorded on the event itself. This is what makes the
    // graph real: without it there is nothing to weigh, and dependency weight
    // would be a claim rather than a measurement.
    via_tool: viaTool ?? null,
    depth: chain.length,
    root_call_id: rootCallId,
    ms: Date.now() - started,
    ...fields,
  });

  const fail = async (status, error, extra = {}) => {
    await record({ version, outcome: "error", error: String(error).slice(0, 300), ...extra });
    return { ok: false, status, error };
  };

  const guard = checkChain(chain, toolId);
  if (!guard.ok) return await fail(409, guard.reason, { stage: "dependency" });

  const tool = await resolveTool(toolId, version);
  if (!tool) return await fail(404, `no such tool: ${toolId}${version ? `@${version}` : ""}`);
  if (!tool.handler_source) {
    return await fail(409, `${toolId}@${tool.version} is registered but carries no executable package`);
  }

  // Checked BEFORE the input schema, the fetch and the transform, so an
  // unapproved tool costs one GetItem rather than a round trip to somebody
  // else's API and a sandbox invocation.
  //
  // Applied at EVERY depth. A tool being approved says nothing about what it
  // depends on, and an approved tool pulling in an unapproved one would be a
  // way to run unreviewed code under a reviewed tool's permission.
  const approval = await approvalFor(toolId, tool.version);
  if (!mayExecute(approval)) {
    return await fail(403, `${toolId}@${tool.version} is not approved for execution (${refusalReason(approval)})`, {
      version: tool.version, stage: "review",
    });
  }

  const schemaErrors = validateInput(tool.input_schema, input);
  if (schemaErrors.length) return await fail(400, schemaErrors.join("; "), { version: tool.version });

  // Dependencies first, so the transform receives finished values.
  //
  // Sequential rather than parallel. The account's entire concurrency ceiling is
  // 10, and a parallel fan-out at depth would contend with itself for the very
  // fetcher and runtime it needs in order to finish. Slower and predictable
  // beats faster and occasionally deadlocked.
  const tools = {};
  for (const dep of tool.uses ?? []) {
    // Resolved against the calling tool's input AND the dependencies that have
    // already run, so one can feed the next. Declaration order is the execution
    // order, and publication already checked that no entry reads from a later
    // one — so there is never a valid order to search for here.
    const { input: depInput, missing } = resolveInputs(dep.input, input, tools);
    if (missing.length) {
      return await fail(400, `dependency ${dep.id}: ${missing.join("; ")}`, {
        version: tool.version, stage: "dependency",
      });
    }
    const sub = await runTool({
      toolId: dep.tool_id,
      version: dep.version ?? null,
      input: depInput,
      provenance,
      chain: [...chain, toolId],
      viaTool: toolId,
      rootCallId,
    });
    if (!sub.ok) {
      // Reported against the tool the caller actually asked for, naming the
      // dependency. A caller who never declared it cannot act on its id alone.
      return await fail(sub.status, `dependency ${dep.id} (${dep.tool_id}) failed: ${sub.error}`, {
        version: tool.version, stage: "dependency",
      });
    }
    tools[dep.id] = sub.result;
  }

  // A tool that declares no requests never reaches the fetcher.
  //
  // Not only an optimisation, though it does save an invocation on every call
  // to a pure composition. A tool composing other tools has no allowlist,
  // because it opens no connection — and asking the fetcher to prove an empty
  // allowlist is safe is asking the wrong question of the wrong component.
  let responses = {};
  if ((tool.requests ?? []).length) {
    const fetched = await invoke(FETCHER_FN, {
      tool_id: toolId, requests: tool.requests, input, allowlist: tool.allowlist ?? [],
    });
    if (!fetched.ok) {
      return await fail(502, `upstream fetch failed: ${fetched.error}`, { version: tool.version, stage: "fetch" });
    }
    responses = fetched.responses;
  }

  const ran = await invoke(RUNTIME_FN, {
    tool_id: toolId, version: tool.version, source: tool.handler_source,
    input, responses, tools,
  });
  if (!ran.ok) {
    return await fail(422, `tool failed: ${ran.error}`, { version: tool.version, stage: "transform" });
  }

  await record({
    version: tool.version, outcome: "success",
    transform_ms: ran.ms ?? null,
    // Which review let this run. Ownership and approvals both change, and an
    // event has to stay true to the moment it was written.
    approved_by: approval.reviewer ?? null,
    // A call by the tool's own owner is not demand, flagged at write time
    // because ownership on either side can change afterwards.
    self_call: isSelfCall({ owner: provenance.owner }, tool),
    dependencies: (tool.uses ?? []).map((u) => u.tool_id),
  });

  return { ok: true, result: ran.result, version: tool.version, ms: Date.now() - started };
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

  // One id shared by every event in this call, dependencies included. It is what
  // turns a scatter of rows into one tree that can be read back.
  const rootCallId = randomUUID();

  try {
    const out = await runTool({
      toolId: tool_id, version, input, provenance,
      chain: [], viaTool: null, rootCallId,
    });
    if (!out.ok) return json(out.status, { error: out.error });

    return json(200, {
      tool: `${tool_id}@${out.version}`,
      result: out.result,
      ms: Date.now() - started,
      call_id: rootCallId,
    });
  } catch (err) {
    console.error(err);
    await recordEvent({
      tool_id, version, outcome: "error", ...provenance,
      root_call_id: rootCallId, depth: 0,
      error: String(err?.message ?? err).slice(0, 300), ms: Date.now() - started,
    });
    return json(500, { error: String(err?.message ?? err) });
  }
};
