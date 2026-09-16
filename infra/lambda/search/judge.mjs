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
// So the ranking stays exactly as it is, and only the yes/no changes: show a
// small model the shortlist and ask whether anything in it genuinely does the
// job. That is the "mini LLM at the edge" PROJECT.md specifies, and it is a
// classification over three candidates rather than a threshold on a moving
// scale.
//
// Pure functions, no AWS imports, so the prompt and the parser are testable
// without credentials.

export const SYSTEM_PROMPT = [
  "You decide whether a tool registry can serve a request.",
  "You are given the user's request and up to three candidate tools with their descriptions.",
  'Answer with JSON only: {"tool_id": "<id>"} if one of them genuinely does the job,',
  'or {"tool_id": null} if none of them does.',
  "Do not invent a tool id. A tool that is merely related to the topic is not a match:",
  "it must actually perform the task asked for.",
].join(" ");

export function buildPrompt(query, candidates) {
  const list = candidates
    .map((c) => `- ${c.tool_id}: ${c.description}`)
    .join("\n");
  return `Request: ${query}\n\nCandidate tools:\n${list}`;
}

export function buildBody(query, candidates, { maxTokens = 60 } = {}) {
  return {
    messages: [{ role: "user", content: [{ text: buildPrompt(query, candidates) }] }],
    system: [{ text: SYSTEM_PROMPT }],
    // Temperature 0: this is a classification, and a gap decision that changes
    // between identical calls would make the gap log unauditable.
    inferenceConfig: { maxTokens, temperature: 0 },
  };
}

// Models wrap JSON in markdown fences often enough that not stripping them is a
// real bug, not a hypothetical one — it made a correct Haiku answer look wrong
// during model selection.
export function parseVerdict(text, allowedIds) {
  if (typeof text !== "string") return { ok: false, tool_id: null, reason: "no text" };
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, tool_id: null, reason: "no json found" };
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return { ok: false, tool_id: null, reason: "invalid json" };
  }
  const id = parsed.tool_id ?? null;
  if (id === null) return { ok: true, tool_id: null, reason: "no tool fits" };
  // A hallucinated id must never be treated as a match. Reject rather than trust.
  if (allowedIds && !allowedIds.includes(id)) {
    return { ok: false, tool_id: null, reason: `hallucinated id: ${String(id).slice(0, 40)}` };
  }
  return { ok: true, tool_id: id, reason: "match" };
}

export function extractText(responseBody) {
  return responseBody?.output?.message?.content?.[0]?.text ?? null;
}

export function extractUsage(responseBody) {
  const u = responseBody?.usage ?? {};
  return { in: u.inputTokens ?? 0, out: u.outputTokens ?? 0 };
}
