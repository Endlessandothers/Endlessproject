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
import { buildIndex, bm25, saturate, fuse } from "./lexical.mjs";
import { buildBody, parseVerdict, extractText, extractUsage } from "./judge.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({});

const TOOLS = process.env.TOOLS_TABLE;
const EVENTS = process.env.EVENTS_TABLE;
const GAPS = process.env.GAPS_TABLE;
const MODEL = process.env.EMBED_MODEL_ID;
const DIMS = Number(process.env.EMBED_DIMS || 1024);
const THRESHOLD_T = Number(process.env.THRESHOLD_T || 0.5);
// 1 = pure cosine, 0 = pure lexical.
const FUSION_ALPHA = Number(process.env.FUSION_ALPHA ?? 1);
const JUDGE_MODEL_ID = process.env.JUDGE_MODEL_ID || "";
const JUDGE_CANDIDATES = Number(process.env.JUDGE_CANDIDATES || 3);

// Cache survives warm invocations. This is what makes brute force viable.
//
// It is TIME-BOUNDED on purpose. With an unbounded cache a newly registered
// tool stays invisible to search until the execution environment happens to
// recycle, which can be minutes or hours and is not observable from outside.
// That silently invalidated a whole evaluation run on 2026-09-16: two different
// description sets produced byte-identical scores because the second was never
// loaded.
let toolCache = null;
let lexIndex = null;
let toolCacheAt = 0;
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 60000);

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
  if (toolCache && Date.now() - toolCacheAt < CACHE_TTL_MS) return toolCache;
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

  toolCacheAt = Date.now();
  toolCache = [...latest.values()].map((t) => ({
    tool_id: t.tool_id,
    version: t.version,
    name: t.name,
    description: t.description,
    vector: unpackVector(t.vec_b64),
  }));

  // Rebuilt from the same rows in the same pass, so the lexical index can never
  // drift out of step with the vectors it sits beside.
  lexIndex = buildIndex(
    toolCache.map((t) => ({ id: t.tool_id, text: `${t.name} ${t.description}` })),
  );
  return toolCache;
}

// Hybrid retrieval. Dense cosine finds paraphrase; BM25 finds the rare exact
// token that a dense vector smears into its neighbourhood — ISBN, cron, kWh.
//
// Every result carries BOTH component scores as well as the fused one. That is
// deliberate: the fusion weight can then be swept offline against real
// evaluation data instead of being guessed at here and redeployed per
// experiment.
async function rankTools(queryVector, queryText, k) {
  const tools = await loadTools();
  return tools
    .map((t) => {
      const dense = cosine(queryVector, t.vector);
      const lexical = saturate(bm25(lexIndex, queryText, t.tool_id));
      return {
        tool_id: t.tool_id, version: t.version, name: t.name,
        description: t.description,
        score: fuse(dense, lexical, FUSION_ALPHA),
        cosine: dense,
        lexical,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// Ask the mini model whether anything in the shortlist actually does the job.
//
// Fails OPEN, deliberately: if the model errors, times out or returns something
// unparseable, fall back to the threshold rather than dropping the gap decision
// entirely. A Bedrock outage should degrade gap quality, not break search.
async function adjudicate(query, results) {
  if (!JUDGE_MODEL_ID) return { used: false };
  const candidates = results.slice(0, JUDGE_CANDIDATES);
  if (candidates.length === 0) return { used: false };
  try {
    const res = await bedrock.send(new InvokeModelCommand({
      modelId: JUDGE_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(buildBody(query, candidates)),
    }));
    const parsed = JSON.parse(new TextDecoder().decode(res.body));
    const verdict = parseVerdict(extractText(parsed), candidates.map((c) => c.tool_id));
    const usage = extractUsage(parsed);
    console.log(JSON.stringify({ metric: "judge_tokens", ...usage, verdict: verdict.reason }));
    if (!verdict.ok) return { used: false, error: verdict.reason };
    return { used: true, tool_id: verdict.tool_id };
  } catch (err) {
    console.error(JSON.stringify({ metric: "judge_error", message: String(err.message).slice(0, 160) }));
    return { used: false, error: "invoke failed" };
  }
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
    const results = await rankTools(vector, query, k);
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
    // The gap decision. The judge replaces the threshold when it is configured
    // and answered; the threshold remains the fallback so a model failure
    // degrades the decision instead of removing it.
    const verdict = await adjudicate(query, results);
    const rejected = body.rejected === true;
    const isGap = verdict.used ? verdict.tool_id === null : top < THRESHOLD_T;

    let gap_id = null;
    if (isGap || rejected) {
      gap_id = randomUUID();
      await ddb.send(new PutCommand({
        TableName: GAPS,
        Item: {
          gap_id, ts, day, query, actor,
          reason: rejected ? "rejected" : (verdict.used ? "judged_no_fit" : "below_threshold"),
          decided_by: verdict.used ? JUDGE_MODEL_ID : "threshold",
          threshold_t: THRESHOLD_T,
          top_k: results,
          embed_model: MODEL,
        },
      }));
    }

    console.log(JSON.stringify({ metric: "embed_tokens", tokens, op: "search" }));

    return json(200, {
      query, results, threshold_t: THRESHOLD_T, fusion_alpha: FUSION_ALPHA,
      decided_by: verdict.used ? JUDGE_MODEL_ID : "threshold",
      judge_error: verdict.error ?? null,
      gap_logged: gap_id !== null, gap_id,
    });
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message });
  }
};
