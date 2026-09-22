// Gap adjudication — the sufficiency judgment the threshold could not make.
//
// WHY THIS REPLACES A NUMBER
//
// Deciding "no tool exists" by asking `top_score < T` failed on a held-out set:
// 31.6% of answerable queries were logged as gaps, including "will it rain in
// Lagos on Friday" at 0.1507. The cause was not bad retrieval. In every one of
// those six failures the correct tool was already in the top three, four of them
// ranked first. Recall@3 was 100% on both evaluation sets.
//
// The scores simply are not on a stable scale: correct hits ran 0.21 and up on
// one set and as low as 0.12 on the next. A fixed cutoff cannot survive that,
// and tuning it harder only fits it to whichever set was used last.
//
// So the ranking stays exactly as it is, and only the yes/no changes: show the
// model the shortlist and ask whether anything in it genuinely does the job.
//
// RUNS ON CLAUDE, ON THE HOT PATH, AND THAT IS EXPENSIVE.
//
// Measured at 207 input and 8 output tokens per search. On Nova Micro that was
// about $8 per million searches, 58% of a $15 total. On Claude Opus 5 it is
// roughly $1,240 per million — the judge stops being the largest line item and
// becomes essentially the whole bill.
//
// It was chosen deliberately, for a reason Phase 3 measured: the old judge
// FALSELY MATCHED. It accepted currency-convert for "what currency and capital
// does a country use" and worldbank-indicator for "region and languages",
// neither of which does that. A real need went unrecorded because search
// believed it was already met — the false-gap problem running backwards, and
// the more damaging direction of the two. A wrongly logged gap wastes effort; a
// wrongly suppressed one is invisible.
//
// Pure functions, no SDK import, so the prompt and the parser stay testable
// without credentials.

export const SYSTEM_PROMPT = [
  "You decide whether a tool registry can serve a request.",
  "You are given the user's request and up to three candidate tools with their descriptions.",
  "Name a tool only if it genuinely performs the task asked for.",
  "A tool that is merely related to the topic is not a match: a currency converter",
  "does not tell you a country's capital, and an economic indicator lookup does not",
  "tell you its languages. When nothing does the job, say so — an unmet need that",
  "gets recorded is useful, and a wrong match hides it.",
].join(" ");

export function buildPrompt(query, candidates) {
  const list = candidates
    .map((c) => `- ${c.tool_id}: ${c.description}`)
    .join("\n");
  return `Request: ${query}\n\nCandidate tools:\n${list}`;
}

// The verdict shape, enforced by the API rather than parsed out of prose.
//
// The previous judge asked for JSON in the prompt and stripped markdown fences
// from the reply, because models wrap JSON in fences often enough that not
// doing so was a real bug rather than a hypothetical one. A schema the server
// validates against removes the whole category.
// {type, schema} and nothing else. `name` and `description` are both rejected
// as "Extra inputs are not permitted" — learned from a 400, after the judge had
// spent a deploy silently falling back to the threshold it was meant to replace.
export const VERDICT_FORMAT = {
  type: "json_schema",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["tool_id"],
    properties: {
      tool_id: {
        type: ["string", "null"],
        description: "The id of the candidate that does the job, or null if none does.",
      },
    },
  },
};

// LOW EFFORT, DELIBERATELY.
//
// Opus 5 runs adaptive thinking by default, and the first deployed version took
// 13.3 SECONDS per search — on a three-way classification over three short
// descriptions. Every one of those seconds is also billed Lambda time at
// 1024 MB, so the slow judge was making the cheap half expensive too.
//
// Low effort is the documented setting for exactly this shape of work: a small
// decision with the evidence already in front of it. Thinking stays ON rather
// than disabled, because disabling it on Opus 5 has its own failure modes and
// lowering effort achieves the same saving without them.
export function buildRequest(query, candidates, { model, maxTokens = 200 } = {}) {
  return {
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    output_config: { effort: "low", format: VERDICT_FORMAT },
    messages: [{ role: "user", content: buildPrompt(query, candidates) }],
  };
}

export function parseVerdict(text, allowedIds) {
  if (typeof text !== "string") return { ok: false, tool_id: null, reason: "no text" };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, tool_id: null, reason: "invalid json" };
  }
  const id = parsed.tool_id ?? null;
  if (id === null) return { ok: true, tool_id: null, reason: "no tool fits" };
  // A hallucinated id must never be treated as a match. Reject rather than
  // trust — a schema constrains the shape, not the contents.
  if (allowedIds && !allowedIds.includes(id)) {
    return { ok: false, tool_id: null, reason: `hallucinated id: ${String(id).slice(0, 40)}` };
  }
  return { ok: true, tool_id: id, reason: "match" };
}

export function extractText(message) {
  const blocks = message?.content ?? [];
  const text = blocks.filter((b) => b?.type === "text").map((b) => b.text).join("");
  return text.length ? text : null;
}

export function extractUsage(message) {
  const u = message?.usage ?? {};
  return { in: u.input_tokens ?? 0, out: u.output_tokens ?? 0 };
}
