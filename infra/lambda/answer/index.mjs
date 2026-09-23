// answer — a question in, an answer out.
//
// WHY THIS EXISTS.
//
// Everything before this returned a TOOL. You asked "how strong is charizard",
// search found pokemon-info-lookup, and then you were handed a form with a
// field called pokemon_name and asked to drive it yourself. That is the right
// interface for an agent, which wants a capability it can compose. It is the
// wrong interface for a person, who asked a question and got a machine.
//
// So this closes the loop: read the question into arguments, run the tool,
// and say what came back in a sentence.
//
// IT DOES NOT CHOOSE THE TOOL. search-fn already did that, and the adjudicator
// already decided whether anything genuinely fits. Re-deciding here would be a
// second opinion from a model that has seen less, and — worse — it would let a
// question get answered by a tool the gap log had already recorded as missing.
// If search says nothing fits, this says so and stops. The unmet need stays
// recorded, which is the entire point of the system.
//
// TWO MODEL CALLS PER QUESTION, and they are not free. The tool is handed to
// Claude as a tool definition, so the arguments come from the same mechanism
// that would extract them anywhere else rather than from a regex over the
// question. Effort is low deliberately: filling two fields from one sentence
// and describing a small JSON object are not reasoning problems, and the judge
// already taught us what adaptive thinking costs on a hot path — 13.3 seconds
// for a three-way classification.

import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import Anthropic from "@anthropic-ai/sdk";

const SEARCH_FN = process.env.SEARCH_FN;
const EXEC_FN = process.env.EXEC_FN;
const KEY_PARAM = process.env.ANTHROPIC_KEY_PARAM || "";
const MODEL = process.env.ANSWER_MODEL_ID || "claude-opus-5";
const TIMEOUT_MS = Number(process.env.ANSWER_TIMEOUT_MS || 20000);

const lambda = new LambdaClient({});
const ssm = new SSMClient({});

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

// The caller's own credential is forwarded, never replaced. This function acts
// on behalf of whoever asked and is charged to them, so a question asked here
// counts exactly as much toward demand as the same question asked over MCP —
// no more, and not as a separate caller.
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

// The registry stores a tool's inputs as {name: {type, required, description}}.
// Anthropic wants JSON Schema. Small, boring, and the place a wrong guess would
// show up as the model inventing field names.
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

const SYSTEM = [
  "You answer a question by calling the one tool you have been given, then saying what it returned.",
  "Call the tool exactly once. Take its arguments from the question.",
  "When the result arrives, answer in plain prose for someone who did not see the JSON:",
  "two or three sentences, the actual numbers and names included, no preamble and no bullet lists.",
  "If the tool fails or returns nothing useful, say plainly what was asked for and that it could not be got.",
  "Never invent a value the tool did not return.",
].join(" ");

export const handler = async (event) => {
  try {
    const auth = event.headers?.authorization ?? event.headers?.Authorization ?? null;
    const body = JSON.parse(event.body || "{}");
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) return json(400, { error: "question is required" });

    const actor = body.actor ?? { agent_id: "answer", session_id: "answer" };

    // Step 1. Who, if anyone, can do this. The verdict is search's to make.
    const found = await forward(SEARCH_FN, auth, "/search", { query: question, k: 5, actor });
    if (found.status !== 200) {
      return json(found.status, { error: found.body.error ?? "search failed" });
    }

    const fits = found.body.fits ?? null;
    if (!fits) {
      // Answering anyway would mean answering from a tool the adjudicator just
      // said does not do this — and the gap it logged would then describe a
      // need that appeared to be met.
      return json(200, {
        question,
        answer: "Nothing in the registry can answer that. It has been recorded as a need nobody met.",
        tool_id: null,
        gap_logged: found.body.gap_logged === true,
      });
    }

    const chosen = (found.body.results ?? []).find((r) => r.tool_id === fits);
    if (!chosen?.input_schema) {
      // A description-only row: search can rank it, nothing can run it.
      return json(200, {
        question,
        answer: `The closest thing here is ${chosen?.name ?? fits}, but it is a description only — there is no code behind it to run.`,
        tool_id: fits,
        runnable: false,
      });
    }

    const tool = {
      name: "registry_tool",
      description: `${chosen.name}. ${chosen.description}`,
      input_schema: toJsonSchema(chosen.input_schema),
    };

    const ai = await client();
    const messages = [{ role: "user", content: question }];

    // Step 2. Read the question into arguments.
    const first = await ai.messages.create({
      model: MODEL, max_tokens: 1000, system: SYSTEM,
      output_config: { effort: "low" },
      tools: [tool], tool_choice: { type: "tool", name: "registry_tool" },
      messages,
    }, { timeout: TIMEOUT_MS });

    const use = (first.content ?? []).find((b) => b.type === "tool_use");
    if (!use) {
      const text = (first.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
      return json(200, { question, answer: text || "Could not work out what to ask the tool.", tool_id: fits });
    }

    // Step 3. Actually run it, under the caller's own credential.
    const ran = await forward(EXEC_FN, auth, "/call", {
      tool_id: fits, input: use.input, actor,
    });
    const failed = ran.status !== 200;

    // Step 4. Say what came back. The failure is fed in as a tool_result rather
    // than thrown, so a broken tool produces a sentence explaining that instead
    // of a stack trace reaching a person who asked about a Pokemon.
    messages.push({ role: "assistant", content: first.content });
    messages.push({
      role: "user",
      content: [{
        type: "tool_result", tool_use_id: use.id, is_error: failed,
        content: JSON.stringify(failed ? { error: ran.body.error ?? `failed (${ran.status})` } : ran.body.result),
      }],
    });

    const second = await ai.messages.create({
      model: MODEL, max_tokens: 1000, system: SYSTEM,
      output_config: { effort: "low" },
      tools: [tool],
      messages,
    }, { timeout: TIMEOUT_MS });

    const answer = (second.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();

    console.log(JSON.stringify({
      metric: "answer", tool_id: fits, ok: !failed,
      in: (first.usage?.input_tokens ?? 0) + (second.usage?.input_tokens ?? 0),
      out: (first.usage?.output_tokens ?? 0) + (second.usage?.output_tokens ?? 0),
    }));

    return json(200, {
      question, answer: answer || "The tool ran but produced nothing to report.",
      tool_id: fits, tool_name: chosen.name,
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
