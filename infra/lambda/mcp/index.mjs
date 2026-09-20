// mcp-fn — Endless as an MCP server. Phase 1, issue #7.
//
// Everything built so far is reachable only by someone who knows how to sign an
// AWS request. This is the endpoint an actual agent can use: JSON-RPC 2.0 over
// HTTP, speaking the Model Context Protocol, exposing three tools —
//
//   endless_search   find a tool for a task, and log a gap when there is none
//   endless_call     run a registered tool
//   endless_gaps     read what nobody could do
//
// A PROTOCOL ADAPTER AND NOTHING ELSE.
//
// It holds no credentials of its own and makes no authorisation decision. The
// caller's Authorization header is forwarded verbatim to search-fn and exec-fn,
// which verify it exactly as they do for any other caller. That is deliberate:
// an adapter that authenticated on its own behalf would be a confused deputy —
// every request would arrive at the registry wearing the adapter's identity,
// and gap counts computed from that would count the adapter, not the agents.
//
// So mcp-fn cannot do anything the caller could not already do, and identity,
// metering and gap provenance stay in one place.

import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const lambda = new LambdaClient({});

const SEARCH_FN = process.env.SEARCH_FN;
const EXEC_FN = process.env.EXEC_FN;
const BOARD_URL = process.env.BOARD_URL || "";

// The protocol versions this server implements. A client asking for something
// else is answered with the newest one here rather than refused — the spec's
// negotiation is "offer what you support" and a hard failure over a version
// string helps nobody.
const SUPPORTED = ["2025-06-18", "2025-03-26"];

const json = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message, data) => ({
  jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) },
});

// JSON-RPC reserved codes. -32602 is invalid params, -32601 method not found,
// -32603 internal. Application failures ride in a result with isError, per MCP,
// so a tool that fails is a normal response the model can read and react to,
// not a transport error that hides the reason.
const INVALID_PARAMS = -32602;
const METHOD_NOT_FOUND = -32601;
const INTERNAL = -32603;
// Outside the reserved range, in the implementation-defined space, so a client
// can tell "you are not allowed" apart from "the server broke".
const UNAUTHORIZED = -32001;

const TOOLS = [
  {
    name: "endless_search",
    title: "Find a tool",
    description:
      "Search the Endless registry for a tool that can do a task. Returns ranked " +
      "candidates. If nothing in the registry can do it, the request is recorded " +
      "as a gap — evidence of an unmet need — and gap_logged comes back true. " +
      "Describe the task in plain language rather than guessing a tool name.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The task, in plain language." },
        k: { type: "integer", description: "How many candidates to return. Default 5.", minimum: 1, maximum: 25 },
      },
      required: ["query"],
    },
  },
  {
    name: "endless_call",
    title: "Run a tool",
    description:
      "Execute a registered Endless tool by id. Use endless_search first to find " +
      "one. The tool runs in a sandbox with no network access of its own; it can " +
      "only reach the upstream hosts it declared when it was published.",
    inputSchema: {
      type: "object",
      properties: {
        tool_id: { type: "string", description: "The tool's id, as returned by endless_search." },
        version: { type: "string", description: "A specific version. Omit for the latest." },
        input: { type: "object", description: "Arguments for the tool, matching its declared input schema." },
      },
      required: ["tool_id"],
    },
  },
  {
    name: "endless_gaps",
    title: "Read unmet needs",
    description:
      "Read the public board of things agents asked for and could not get, " +
      "grouped by meaning and counted by distinct callers. Useful for deciding " +
      "what to build. Returns counts only, never who asked.",
    inputSchema: {
      type: "object",
      properties: {
        confirmed_only: {
          type: "boolean",
          description: "Only needs that have repeated across enough separate callers. Default true.",
        },
      },
    },
  },
];

// Invoke a sibling function with the caller's own Authorization header.
async function forward(fn, auth, body) {
  const res = await lambda.send(new InvokeCommand({
    FunctionName: fn,
    InvocationType: "RequestResponse",
    Payload: Buffer.from(JSON.stringify({
      version: "2.0",
      rawPath: "/",
      isBase64Encoded: false,
      requestContext: { http: { method: "POST" } },
      headers: auth ? { authorization: auth } : {},
      body: JSON.stringify(body),
    })),
  }));
  const text = Buffer.from(res.Payload ?? []).toString("utf8");
  if (res.FunctionError) throw new Error(`${fn} failed`);
  const envelope = JSON.parse(text || "{}");
  return { status: envelope.statusCode ?? 500, body: JSON.parse(envelope.body || "{}") };
}

// MCP tool results are content blocks. Text, because every client renders it
// and a model reads JSON in a text block perfectly well.
const content = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });
const failure = (message) => ({ content: [{ type: "text", text: message }], isError: true });

async function callTool(name, args, auth, actor) {
  if (name === "endless_search") {
    if (typeof args?.query !== "string" || !args.query.trim()) {
      return failure("query is required and must be a non-empty string");
    }
    const { status, body } = await forward(SEARCH_FN, auth, {
      query: args.query, k: Math.min(Number(args.k) || 5, 25), actor,
    });
    if (status !== 200) return failure(`search failed (${status}): ${body.error ?? "unknown"}`);

    // Trimmed on purpose. The raw response carries a vector-scale score, both
    // component scores and the threshold, which are meaningful to someone
    // tuning retrieval and pure noise to an agent choosing a tool.
    return content({
      results: (body.results ?? []).map((r) => ({
        tool_id: r.tool_id, version: r.version, name: r.name, description: r.description,
      })),
      gap_logged: body.gap_logged,
      ...(body.gap_logged
        ? { note: "Nothing in the registry does this. It has been recorded as an unmet need." }
        : {}),
    });
  }

  if (name === "endless_call") {
    if (typeof args?.tool_id !== "string" || !args.tool_id) {
      return failure("tool_id is required");
    }
    const { status, body } = await forward(EXEC_FN, auth, {
      tool_id: args.tool_id, version: args.version ?? null, input: args.input ?? {}, actor,
    });
    // A tool that failed is reported as a readable failure, not a transport
    // error: the model can act on "missing required input: lat" and cannot act
    // on a JSON-RPC code.
    if (status !== 200) return failure(`${body.error ?? `call failed with ${status}`}`);
    return content({ tool: body.tool, result: body.result, ms: body.ms });
  }

  if (name === "endless_gaps") {
    if (!BOARD_URL) return failure("the gaps board is not configured");
    const res = await fetch(`${BOARD_URL}gaps.json`, { headers: { accept: "application/json" } });
    if (!res.ok) return failure(`could not read the board: HTTP ${res.status}`);
    const board = await res.json();
    const only = args?.confirmed_only !== false;
    const clusters = (board.clusters ?? []).filter((c) => (only ? c.confirmed : true));
    return content({
      generated_at: board.generated_at,
      rule: board.rule,
      needs: clusters.map((c) => ({
        id: c.id, need: c.label,
        distinct_callers: c.distinct_callers, distinct_owners: c.distinct_owners,
        occurrences: c.occurrences, spread_days: c.spread_days,
        confirmed: c.confirmed, flags: c.flags,
      })),
    });
  }

  return failure(`no such tool: ${name}`);
}

// Every method needs a key, initialize and tools/list included.
//
// This endpoint is authorization_type NONE at the Function URL, because an
// agent runtime can send a bearer token and cannot sign SigV4. That makes it
// the one publicly reachable surface in Endless, so the cheapest possible
// rejection has to come first: shape-checking the header costs nothing and no
// downstream Lambda is invoked, no model is called and no table is read.
//
// It is a SHAPE check, not a verification — this function holds no credentials
// and reads no table, by design. A well-formed but invented key still gets a
// 401, from search-fn or exec-fn, the moment it asks for anything real. What
// this stops is the free part of the flood: unauthenticated requests that would
// otherwise make the server work for nothing.
//
// MCP clients send Authorization on every request including initialize, so this
// costs a legitimate client nothing.
const KEY_SHAPE = /^Bearer\s+elk_[a-z0-9][a-z0-9-]{1,38}_.+$/i;

async function dispatch(req, auth) {
  const { id = null, method, params = {} } = req ?? {};

  if (!KEY_SHAPE.test(String(auth ?? ""))) {
    // Notifications still get nothing back, even when refused.
    if (id === null || id === undefined) return null;
    return rpcError(id, UNAUTHORIZED,
      "an Endless API key is required: send it as Authorization: Bearer elk_<caller>_<secret>");
  }

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "endless", version: "1.0.0" },
        instructions:
          "Endless is a registry of small tools. Search it before assuming a capability " +
          "does not exist. When a search finds nothing, that is recorded as evidence of " +
          "an unmet need, so searching for something that is missing is useful rather " +
          "than wasted — do not avoid it.",
      });

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, { tools: TOOLS });

    case "tools/call": {
      const name = params?.name;
      if (!name) return rpcError(id, INVALID_PARAMS, "params.name is required");
      // The MCP session is the actor. It is self-declared and recorded as such;
      // the identity that counts comes from the forwarded key.
      const actor = {
        agent_id: params?._meta?.agent_id ?? "mcp-client",
        session_id: params?._meta?.session_id ?? `mcp-${id ?? "0"}`,
      };
      return rpcResult(id, await callTool(name, params.arguments ?? {}, auth, actor));
    }

    default:
      // Notifications have no id and expect no reply.
      if (id === null || id === undefined) return null;
      return rpcError(id, METHOD_NOT_FOUND, `unsupported method: ${method}`);
  }
}

export const handler = async (event) => {
  const method = event?.requestContext?.http?.method ?? "POST";
  if (method === "GET") {
    // No SSE stream. Every tool here is a single request and response, and an
    // open stream would be a long-lived billable connection for nothing.
    return json(405, { error: "this server supports POST only; there is no event stream" });
  }
  if (method !== "POST") return json(405, { error: `unsupported method: ${method}` });

  const auth = event?.headers?.authorization ?? event?.headers?.Authorization ?? null;
  const raw = event?.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf8")
    : event?.body;

  let req;
  try { req = JSON.parse(raw || "{}"); }
  catch { return json(400, rpcError(null, -32700, "parse error")); }

  try {
    // A batch is an array. Notifications in it produce no reply, so a batch of
    // only notifications answers 202 with no body, per JSON-RPC.
    if (Array.isArray(req)) {
      const out = (await Promise.all(req.map((r) => dispatch(r, auth)))).filter(Boolean);
      return out.length ? json(200, out) : { statusCode: 202, body: "" };
    }
    const out = await dispatch(req, auth);
    return out ? json(200, out) : { statusCode: 202, body: "" };
  } catch (err) {
    console.error(err);
    return json(200, rpcError(req?.id ?? null, INTERNAL, String(err?.message ?? err).slice(0, 200)));
  }
};
