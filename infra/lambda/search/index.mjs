// search-fn — embed the query, rank by cosine, emit an event, decide on a gap.
//
// No vector database on purpose. Phase 0 has 15-20 tools; cosine over 20 vectors
// held in module scope is sub-millisecond and costs nothing. The ranking call
// sits behind rankTools() so the implementation can be swapped in Phase 1
// without touching any caller.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { randomUUID } from "node:crypto";
import { unpackVector, cosine } from "./vector.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({});

const TOOLS = process.env.TOOLS_TABLE;
const EVENTS = process.env.EVENTS_TABLE;
const GAPS = process.env.GAPS_TABLE;
const MODEL = process.env.EMBED_MODEL_ID;
const DIMS = Number(process.env.EMBED_DIMS || 1024);
const THRESHOLD_T = Number(process.env.THRESHOLD_T || 0.5);

// Cache survives warm invocations. This is what makes brute force viable.
let toolCache = null;

const json = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function embed(text) {
  const res = await bedrock.send(new InvokeModelCommand({
    modelId: MODEL,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({ inputText: text, dimensions: DIMS, normalize: true }),
  }));
  const parsed = JSON.parse(new TextDecoder().decode(res.body));
  return { vector: parsed.embedding, tokens: parsed.inputTextTokenCount ?? 0 };
}

// Authority for a vector is the tool row. The S3 snapshot is a derived cache.
async function loadTools() {
  if (toolCache) return toolCache;
  const latest = new Map();
  let key;
  do {
    const out = await ddb.send(new ScanCommand({
      TableName: TOOLS, ExclusiveStartKey: key,
    }));
    for (const item of out.Items ?? []) {
      const seen = latest.get(item.tool_id);
      if (!seen || Number(item.version) > Number(seen.version)) latest.set(item.tool_id, item);
    }
    key = out.LastEvaluatedKey;
  } while (key);

  toolCache = [...latest.values()].map((t) => ({
    tool_id: t.tool_id,
    version: t.version,
    name: t.name,
    description: t.description,
    vector: unpackVector(t.vec_b64),
  }));
  return toolCache;
}

async function rankTools(queryVector, k) {
  const tools = await loadTools();
  return tools
    .map((t) => ({
      tool_id: t.tool_id, version: t.version, name: t.name,
      score: cosine(queryVector, t.vector),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export const handler = async (event) => {
  const raw = event?.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf8")
    : event?.body;

  try {
    const body = raw ? JSON.parse(raw) : {};
    const query = body.query;
    const actor = body.actor;
    const k = Math.min(Number(body.k || 5), 25);

    if (!query) return json(400, { error: "missing field: query" });

    // Invariant #4: a gap record must always carry which agent/session produced
    // it, so manufactured demand can be traced. No provenance, no write.
    if (!actor?.agent_id || !actor?.session_id) {
      return json(400, { error: "actor.agent_id and actor.session_id are required" });
    }

    const { vector, tokens } = await embed(query);
    const results = await rankTools(vector, k);
    const top = results[0]?.score ?? 0;

    const ts = new Date().toISOString();
    const day = ts.slice(0, 10);

    await ddb.send(new PutCommand({
      TableName: EVENTS,
      Item: {
        event_id: randomUUID(), ts, day, type: "search",
        actor, query, top_score: top, result_count: results.length,
        embed_tokens: tokens, embed_model: MODEL,
      },
    }));

    // A gap is logged when nothing clears T, or when the caller rejected every
    // result. The full top-k and the T in force are both stored, so a later
    // reader can judge "search failed" against "the tool does not exist" — and
    // so moving T never silently reinterprets old records.
    let gap_id = null;
    const rejected = body.rejected === true;
    if (top < THRESHOLD_T || rejected) {
      gap_id = randomUUID();
      await ddb.send(new PutCommand({
        TableName: GAPS,
        Item: {
          gap_id, ts, day, query, actor,
          reason: rejected ? "rejected" : "below_threshold",
          threshold_t: THRESHOLD_T,
          top_k: results,
          embed_model: MODEL,
        },
      }));
    }

    console.log(JSON.stringify({ metric: "embed_tokens", tokens, op: "search" }));

    return json(200, {
      query, results, threshold_t: THRESHOLD_T,
      gap_logged: gap_id !== null, gap_id,
    });
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message });
  }
};
