// search-fn — embed the query, rank by cosine, emit an event, decide on a gap.
//
// No vector database on purpose. Phase 0 has 15-20 tools; cosine over 20 vectors
// held in module scope is sub-millisecond and costs nothing. The ranking call
// sits behind rankTools() so the implementation can be swapped in Phase 1
// without touching any caller.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { randomUUID } from "node:crypto";
import { packVector, unpackVector, cosine } from "./vector.mjs";
import { buildIndex, bm25, saturate, fuse } from "./lexical.mjs";
import Anthropic from "@anthropic-ai/sdk";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { buildRequest, parseVerdict, extractText, extractUsage } from "./judge.mjs";
import { authenticate, provenanceOf } from "./auth.mjs";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({});

const TOOLS = process.env.TOOLS_TABLE;
const EVENTS = process.env.EVENTS_TABLE;
const GAPS = process.env.GAPS_TABLE;
const CALLERS = process.env.CALLERS_TABLE;
const MODEL = process.env.EMBED_MODEL_ID;
const DIMS = Number(process.env.EMBED_DIMS || 1024);
const THRESHOLD_T = Number(process.env.THRESHOLD_T || 0.5);
// 1 = pure cosine, 0 = pure lexical.
const FUSION_ALPHA = Number(process.env.FUSION_ALPHA ?? 1);
const JUDGE_MODEL_ID = process.env.JUDGE_MODEL_ID || "";
const KEY_PARAM = process.env.ANTHROPIC_KEY_PARAM || "";
const JUDGE_TIMEOUT_MS = Number(process.env.JUDGE_TIMEOUT_MS || 12000);
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

// Deliberately not cached. A suspended caller must stop working at once, and a
// cached row means suspension takes effect whenever the container happens to
// recycle. See the note on the table in infra/callers.tf.
const lookupCaller = async (callerId) => {
  const out = await ddb.send(new GetCommand({
    TableName: CALLERS, Key: { caller_id: callerId },
  }));
  return out.Item ?? null;
};

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
    // What the tool actually takes. It was always in the row and never came
    // out, so every caller had to discover the field names by being refused —
    // which is a fine way to learn a boundary and a terrible way to learn a
    // form. Not used for ranking; carried so a result is usable on arrival.
    input_schema: t.input_schema ?? null,
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
        description: t.description, input_schema: t.input_schema ?? null,
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
// The key, read once per execution environment from SSM Parameter Store.
//
// NOT a Lambda environment variable, and not a Terraform variable. An env var is
// readable by anyone with lambda:GetFunctionConfiguration, and a Terraform
// variable would put the key in the state file. A SecureString parameter keeps
// it out of both, and out of git.
//
// This is the first stored credential in the project. Everything else
// authenticates with IAM and stores nothing — the CI role assumes through OIDC,
// the functions carry roles, the callers table holds only hashes. That property
// is now broken on purpose, and it is worth knowing it was a trade rather than
// an oversight: an Anthropic key cannot be granted through IAM.
const ssm = new SSMClient({});
let anthropic = null;

async function judge() {
  if (anthropic) return anthropic;
  const out = await ssm.send(new GetParameterCommand({ Name: KEY_PARAM, WithDecryption: true }));
  // maxRetries 1, not the default 2. The judge already fails open to the
  // threshold, so a third attempt buys a slightly better answer at the cost of
  // the whole search taking longer than the function is allowed to live.
  anthropic = new Anthropic({ apiKey: out.Parameter.Value, maxRetries: 1 });
  return anthropic;
}

async function adjudicate(query, results) {
  if (!JUDGE_MODEL_ID) return { used: false };
  const candidates = results.slice(0, JUDGE_CANDIDATES);
  if (candidates.length === 0) return { used: false };
  try {
    const client = await judge();
    // A BUDGET SHORTER THAN THE FUNCTION'S OWN TIMEOUT.
    //
    // search-fn lives 30 seconds. An Opus 5 judge occasionally takes longer
    // than that, and when it did the whole search died — returning nothing at
    // all, rather than the ranked results it already had in hand.
    //
    // That was the fail-open not firing: it catches errors, and a Lambda being
    // killed is not an error the Lambda gets to catch. With a client budget of
    // 12s and one retry, the worst case stays inside 30s and a slow judge
    // degrades to the threshold exactly as a broken one does.
    const message = await client.messages.create(
      buildRequest(query, candidates, { model: JUDGE_MODEL_ID }),
      { timeout: JUDGE_TIMEOUT_MS },
    );
    const verdict = parseVerdict(extractText(message), candidates.map((c) => c.tool_id));
    const usage = extractUsage(message);
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
    //
    // actor is the caller's own sub-identity — which of its agents and sessions
    // asked. It stays useful and it stays UNVERIFIED. The identity that counts
    // is the one below, proved against a stored hash.
    if (!actor?.agent_id || !actor?.session_id) {
      return json(400, { error: "actor.agent_id and actor.session_id are required" });
    }

    // Before the embedding, not after.
    //
    // A search costs a Titan embedding and, on the gap path, a Nova Micro
    // adjudication. Authenticating first means an unauthenticated flood is
    // rejected for the price of one GetItem instead of one model call each.
    // This is the cheapest of the DDoS mitigations and the reason it runs here
    // rather than wherever it would read most naturally.
    const auth = await authenticate(event?.headers, lookupCaller);
    if (!auth.ok) return json(auth.status, { error: auth.error });
    if (auth.caller.status !== "active") {
      return json(403, { error: `caller is ${auth.caller.status}` });
    }

    // Searching is free. The paywall is on PUBLISHING a tool, not on asking —
    // charging for questions would suppress exactly the gap signal the registry
    // exists to collect. registry-fn holds the debit.
    const provenance = provenanceOf(auth.caller, actor);

    const { vector, tokens } = await embed(query);
    const results = await rankTools(vector, query, k);
    const top = results[0]?.score ?? 0;

    const ts = new Date().toISOString();
    const day = ts.slice(0, 10);

    await ddb.send(new PutCommand({
      TableName: EVENTS,
      Item: {
        event_id: randomUUID(), ts, day, type: "search",
        ...provenance,
        query, top_score: top, result_count: results.length,
        // Which tools came back together, best first. Ids only, and written on
        // EVERY search rather than only on gaps.
        //
        // This is the raw material for knowing which tools COMPETE. Two tools
        // that keep appearing in the same shortlist are candidates for the same
        // job, whatever their descriptions say and whatever category someone
        // filed them under. Measured 2026-09-20: description similarity
        // recovers hand-assigned categories at F1 0.565, nowhere near good
        // enough to decide anything — sunrise-sunset and postal-code-lookup are
        // both filed "geo" and do unrelated things, while air-quality and
        // weather-forecast are close neighbours filed apart.
        ranked: results.map((r) => r.tool_id),
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

    // THE BUILDER'S SEARCHES ARE NOT DEMAND.
    //
    // Found by looking at why the gap count had gone from 3 to 36: 33 of them
    // were the builder asking "does anything already do this?" — six times for
    // one need, because the builder was run six times against it.
    //
    // That is not noise, it is a feedback loop. Every check the builder makes
    // inflates the demand for the thing it is checking, which makes that need
    // look more worth building, which is a justification manufacturing itself.
    // The one shape this entire project exists to prevent, arriving from the
    // inside.
    //
    // The search still runs and is still recorded as an event — the builder
    // needs the answer and the cost should be visible. It simply never becomes
    // a gap.
    const isBuilder = provenance.role === "builder";

    let gap_id = null;
    if ((isGap || rejected) && !isBuilder) {
      gap_id = randomUUID();
      await ddb.send(new PutCommand({
        TableName: GAPS,
        Item: {
          gap_id, ts, day, query, ...provenance,
          // The query vector, stored because it was already computed above.
          // Clustering groups gaps by meaning, and re-embedding every gap on
          // every nightly run would be a recurring bill for something that was
          // free at write time.
          vec_b64: packVector(vector),
          vec_dims: vector.length,
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
      // THE ANSWER, said plainly rather than left to be inferred.
      //
      // The builder's duplicate check used to read gap_logged and treat "a gap
      // was recorded" as "nothing fits". The moment builder searches stopped
      // logging gaps, that inference collapsed and the check began reporting
      // that recent-earthquakes answers "what type is pikachu".
      //
      // gap_logged is a SIDE EFFECT of the verdict, filtered by who asked.
      // This is the verdict. Anything deciding whether a tool exists should
      // read this, and a side effect should never have been load-bearing.
      fits: verdict.used ? verdict.tool_id : (top >= THRESHOLD_T ? results[0]?.tool_id ?? null : null),
      gap_logged: gap_id !== null, gap_id,
      // Said plainly rather than left for the caller to infer from a null id.
      ...(isBuilder && isGap ? { note: "nothing fits, and a builder's search is not recorded as demand" } : {}),
    });
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message });
  }
};
