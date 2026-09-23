// answer — the model is the centre; tools are what it reaches for.
//
// WHAT CHANGED, AND WHY IT MATTERS MORE THAN IT LOOKS.
//
// The first version of this file assumed every question needed a tool. It
// searched, took whatever the adjudicator said fitted, and drove it. That is
// backwards for most questions. "What is the capital of France" needs no tool.
// Neither does "explain what a base stat total means". A model answers those
// instantly, correctly, and for a fraction of a cent, and routing them through
// a registry adds latency, cost and nothing else.
//
// Worse, it corrupted the gap log. An unmet need was defined as "no tool fits",
// so every question the registry could not serve — including every question
// that never needed serving — was recorded as evidence of a missing tool. The
// gap log is the one artefact this project produces that cannot be rebuilt
// from anything else. Filling it with "what is 2+2" makes it worthless.
//
// THE NEW RULE: A TOOL IS NEEDED WHEN KNOWING IS NOT ENOUGH.
//
// Three outcomes, and the model chooses between them explicitly rather than by
// implication:
//
//   1. It knows the answer      -> answer. No tool, no gap, one cheap call.
//   2. A registry tool does it  -> call it. That is what tools are for.
//   3. Neither                  -> record an unmet need, and say so.
//
// The line between 1 and 2 is not difficulty, it is KNOWABILITY. A model cannot
// know today's air quality in Lisbon however hard it thinks; that is not a hard
// question, it is an unknowable one, and guessing at it is the failure mode
// that matters. Meanwhile a genuinely hard question it can reason through needs
// no tool at all.
//
// AND COST IS A SIGNAL. If the model answers, but burns a great many tokens
// doing it, that is a tool-shaped hole even though nothing was missing. A tool
// exists to make a repeated expensive thing cheap. Those are recorded as gaps
// with their own reason, so a later reader can tell "nobody could answer this"
// from "answering this was expensive enough to be worth automating" — two very
// different arguments for building something.

import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";

const SEARCH_FN = process.env.SEARCH_FN;
const EXEC_FN = process.env.EXEC_FN;
const GAPS = process.env.GAPS_TABLE;
const KEY_PARAM = process.env.ANTHROPIC_KEY_PARAM || "";
const MODEL = process.env.ANSWER_MODEL_ID || "claude-opus-5";
const TIMEOUT_MS = Number(process.env.ANSWER_TIMEOUT_MS || 20000);
// Output tokens past which answering without a tool counts as expensive enough
// to be worth recording. Output rather than input because input is the question
// plus a few tool descriptions and barely moves, while output carries the
// thinking — which is where an expensive answer actually spends.
const EXPENSIVE_OUTPUT_TOKENS = Number(process.env.ANSWER_EXPENSIVE_TOKENS || 1200);

const lambda = new LambdaClient({});
const ssm = new SSMClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const json = (status, body) => ({
  statusCode: status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

let anthropic = null;
async function client() {
  if (anthropic) return anthropic;
  const out = await ssm.send(new GetParameterCommand({ Name: KEY_PARAM, WithDecryption: true }));
  anthropic = new Anthropic({ apiKey: out.Parameter.Value, maxRetries: 1 });
  return anthropic;
}

// The caller's own credential is forwarded, never replaced. A question asked
// here is charged to whoever asked it and counts exactly once toward demand.
// A service identity of its own would make every question look like the same
// caller and quietly corrupt the only number this registry rests on.
async function forward(fn, auth, path, body) {
  const res = await lambda.send(new InvokeCommand({
    FunctionName: fn,
    InvocationType: "RequestResponse",
    Payload: Buffer.from(JSON.stringify({
      version: "2.0", rawPath: path, isBase64Encoded: false,
      requestContext: { http: { method: "POST" } },
      headers: auth ? { authorization: auth } : {},
      body: JSON.stringify(body),
    })),
  }));
  const out = JSON.parse(Buffer.from(res.Payload).toString());
  return { status: out.statusCode, body: JSON.parse(out.body || "{}") };
}

// The registry stores inputs as {name: {type, required, description}}; the API
// wants JSON Schema. Small and boring, and the place a wrong guess shows up as
// the model inventing field names.
export function toJsonSchema(input) {
  const properties = {};
  const required = [];
  for (const [name, f] of Object.entries(input ?? {})) {
    const t = f?.type === "number" || f?.type === "integer" ? "number"
            : f?.type === "boolean" ? "boolean"
            : f?.type === "array" ? "array"
            : f?.type === "object" ? "object"
            : "string";
    properties[name] = { type: t, ...(f?.description ? { description: f.description } : {}) };
    if (f?.required) required.push(name);
  }
  return { type: "object", properties, required };
}

// Tool ids are not valid tool names for the API, and a name has to survive the
// round trip back to a registry lookup, so the mapping is kept rather than
// reconstructed.
const toolNameFor = (id) => "use_" + String(id).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 60);

export const UNMET = "record_unmet_need";

export const SYSTEM = [
  "You answer questions. You also have access to a registry of small tools.",
  "",
  "Answer directly, from what you know, whenever you reliably can. Most questions do not need a tool:",
  "stable facts, definitions, explanations, reasoning, arithmetic, writing, opinions about known things.",
  "Using a tool for those wastes time and money and makes the answer no better.",
  "",
  "Use a tool when knowing is not enough — when the answer depends on something you cannot know:",
  "anything live or changing (weather, air quality, prices, the current time, recent events),",
  "anything that must be looked up in an authoritative source rather than recalled,",
  "and anything where being out of date would make the answer wrong.",
  "Never guess at live data. An out-of-date number stated confidently is worse than no answer.",
  "",
  `Call ${UNMET} when the question needs something you cannot know and no tool here provides it,`,
  "or when it asks you to take an action in the world rather than to know something.",
  "Do not call it merely because a question is hard — hard questions you can reason through are yours to answer.",
  "",
  "When a tool returns, answer in plain prose for someone who did not see the JSON:",
  "two or three sentences, the actual numbers and names included, no preamble and no bullet lists.",
  "Never invent a value a tool did not return.",
].join("\n");

export const UNMET_TOOL = {
  name: UNMET,
  description:
    "Record that this question cannot be answered — neither from what you know nor by any tool here. " +
    "Use it for questions needing live or external data no tool covers, or asking for an action to be taken.",
  input_schema: {
    type: "object",
    properties: {
      need: {
        type: "string",
        description: "What would have to exist to answer this, in one short phrase. E.g. 'restaurant table booking'.",
      },
    },
    required: ["need"],
  },
};

async function recordGap(deferred, extra) {
  if (!deferred || !GAPS) return null;
  const gap_id = randomUUID();
  await ddb.send(new PutCommand({
    TableName: GAPS,
    Item: { ...deferred, ...extra, gap_id },
  }));
  return gap_id;
}

export const handler = async (event) => {
  try {
    const auth = event.headers?.authorization ?? event.headers?.Authorization ?? null;
    const body = JSON.parse(event.body || "{}");
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) return json(400, { error: "question is required" });
    const actor = body.actor ?? { agent_id: "answer", session_id: "answer" };

    // What the registry has that might be relevant. The gap is DEFERRED: at
    // this point nobody knows yet whether this question needed a tool at all.
    const found = await forward(SEARCH_FN, auth, "/search", {
      query: question, k: 5, actor, defer_gap: true,
    });
    if (found.status !== 200) return json(found.status, { error: found.body.error ?? "search failed" });

    const deferred = found.body.deferred_gap ?? null;

    // EVERY runnable candidate is offered, not just the one the adjudicator
    // picked. The adjudicator answers "does anything here do this job", which is
    // the right question for the gap log and the wrong one here: the model is
    // about to decide whether it needs a tool at all, and it should make that
    // choice seeing the actual options.
    const candidates = (found.body.results ?? []).filter((r) => r.input_schema);
    const byName = new Map();
    const tools = candidates.map((r) => {
      const name = toolNameFor(r.tool_id);
      byName.set(name, r);
      return {
        name,
        description: `${r.name}. ${r.description}`,
        input_schema: toJsonSchema(r.input_schema),
      };
    });
    tools.push(UNMET_TOOL);

    const ai = await client();
    const messages = [{ role: "user", content: question }];

    const first = await ai.messages.create({
      model: MODEL, max_tokens: 2000, system: SYSTEM,
      output_config: { effort: "low" },
      tools,
      messages,
    }, { timeout: TIMEOUT_MS });

    const use = (first.content ?? []).find((b) => b.type === "tool_use");
    const textOf = (m) => (m.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const firstOut = first.usage?.output_tokens ?? 0;

    // ---------------------------------------------------------------- 1. it knew
    if (!use) {
      const answer = textOf(first);
      // Answered without a tool. Not a gap in itself — but if it cost a lot to
      // answer, a tool would have paid for itself, and that is worth recording
      // as a different kind of demand.
      const expensive = firstOut >= EXPENSIVE_OUTPUT_TOKENS;
      const gap_id = expensive
        ? await recordGap(deferred, {
            reason: "answered_but_expensive",
            decided_by: MODEL,
            answered_without_tool: true,
            output_tokens: firstOut,
          })
        : null;

      console.log(JSON.stringify({
        metric: "answer", route: "model", tool_id: null,
        in: first.usage?.input_tokens ?? 0, out: firstOut, expensive, gap_id,
      }));

      return json(200, {
        question, answer, tool_id: null, answered_by: "model",
        tokens: { out: firstOut },
        // Said plainly rather than left to be inferred. "No tool was used" and
        // "no tool exists" are different facts and were being conflated.
        needed_a_tool: false,
        gap_logged: gap_id !== null,
        ...(expensive ? { note: "Answered without a tool, but expensively — recorded as a tool worth having." } : {}),
      });
    }

    // ---------------------------------------------------------------- 3. neither
    if (use.name === UNMET) {
      const need = use.input?.need ?? question;
      const gap_id = await recordGap(deferred, {
        reason: "model_cannot_answer",
        decided_by: MODEL,
        need_label: String(need).slice(0, 200),
      });

      console.log(JSON.stringify({
        metric: "answer", route: "unmet", need, gap_id,
        in: first.usage?.input_tokens ?? 0, out: firstOut,
      }));

      return json(200, {
        question,
        answer: `Nothing here can answer that — it needs ${need}, and no tool in the registry provides it. It has been recorded as a need nobody met.`,
        tool_id: null, answered_by: "nobody", need: String(need).slice(0, 200),
        needed_a_tool: true, gap_logged: gap_id !== null,
      });
    }

    // ---------------------------------------------------------------- 2. a tool does it
    const chosen = byName.get(use.name);
    if (!chosen) return json(500, { error: `model called an unknown tool: ${use.name}` });

    const ran = await forward(EXEC_FN, auth, "/call", {
      tool_id: chosen.tool_id, input: use.input, actor,
    });
    const failed = ran.status !== 200;

    // The failure is fed back as a tool_result rather than thrown, so a broken
    // tool produces a sentence explaining that instead of a stack trace reaching
    // somebody who asked about the weather.
    messages.push({ role: "assistant", content: first.content });
    messages.push({
      role: "user",
      content: [{
        type: "tool_result", tool_use_id: use.id, is_error: failed,
        content: JSON.stringify(failed ? { error: ran.body.error ?? `failed (${ran.status})` } : ran.body.result),
      }],
    });

    const second = await ai.messages.create({
      model: MODEL, max_tokens: 1500, system: SYSTEM,
      output_config: { effort: "low" }, tools,
      messages,
    }, { timeout: TIMEOUT_MS });

    console.log(JSON.stringify({
      metric: "answer", route: "tool", tool_id: chosen.tool_id, ok: !failed,
      in: (first.usage?.input_tokens ?? 0) + (second.usage?.input_tokens ?? 0),
      out: firstOut + (second.usage?.output_tokens ?? 0),
    }));

    return json(200, {
      question,
      answer: textOf(second) || "The tool ran but produced nothing to report.",
      tool_id: chosen.tool_id, tool_name: chosen.name, answered_by: "tool",
      needed_a_tool: true, gap_logged: false,
      // The raw result travels too. The prose is for a person; anything built
      // on this should read the object rather than parse the sentence.
      input: use.input, result: failed ? null : ran.body.result,
      error: failed ? (ran.body.error ?? `failed (${ran.status})`) : null,
      ms: ran.body.ms ?? null,
    });
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message });
  }
};
