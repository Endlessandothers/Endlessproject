import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPrompt, buildBody, parseVerdict, extractText, extractUsage, SYSTEM_PROMPT,
} from "../lambda/search/judge.mjs";

const CANDS = [
  { tool_id: "weather-forecast", description: "Weather forecast by hour and by day." },
  { tool_id: "qr-code-generate", description: "Generates a scannable QR barcode image." },
];
const IDS = CANDS.map((c) => c.tool_id);

test("prompt contains the request and every candidate id", () => {
  const p = buildPrompt("will it rain", CANDS);
  assert.match(p, /will it rain/);
  for (const id of IDS) assert.ok(p.includes(id), `missing ${id}`);
});

test("body pins temperature to 0", () => {
  // A gap decision that changes between identical calls makes the log unauditable.
  assert.equal(buildBody("q", CANDS).inferenceConfig.temperature, 0);
});

test("body carries the system prompt and one user message", () => {
  const b = buildBody("q", CANDS);
  assert.equal(b.system[0].text, SYSTEM_PROMPT);
  assert.equal(b.messages.length, 1);
  assert.equal(b.messages[0].role, "user");
});

test("parses a bare json verdict", () => {
  assert.deepEqual(parseVerdict('{"tool_id":"weather-forecast"}', IDS),
    { ok: true, tool_id: "weather-forecast", reason: "match" });
});

test("parses a null verdict as a genuine gap", () => {
  const v = parseVerdict('{"tool_id": null}', IDS);
  assert.equal(v.ok, true);
  assert.equal(v.tool_id, null);
});

// Not hypothetical: a correct Haiku answer was scored as wrong during model
// selection purely because of the fence.
test("strips markdown code fences", () => {
  const v = parseVerdict('```json\n{"tool_id": "weather-forecast"}\n```', IDS);
  assert.equal(v.tool_id, "weather-forecast");
});

test("tolerates prose around the json", () => {
  const v = parseVerdict('Sure! Here is my answer:\n{"tool_id":"qr-code-generate"}\nHope that helps.', IDS);
  assert.equal(v.tool_id, "qr-code-generate");
});

test("rejects a hallucinated tool id rather than trusting it", () => {
  const v = parseVerdict('{"tool_id":"weather-api-pro"}', IDS);
  assert.equal(v.ok, false);
  assert.equal(v.tool_id, null);
  assert.match(v.reason, /hallucinated/);
});

test("unparseable output fails closed, never as a match", () => {
  for (const bad of ["", "I am not sure", "{broken", null, undefined]) {
    const v = parseVerdict(bad, IDS);
    assert.equal(v.ok, false, `expected failure for ${JSON.stringify(bad)}`);
    assert.equal(v.tool_id, null);
  }
});

test("extractText and extractUsage read the Nova response shape", () => {
  const body = {
    output: { message: { content: [{ text: '{"tool_id":null}' }] } },
    usage: { inputTokens: 193, outputTokens: 11 },
  };
  assert.equal(extractText(body), '{"tool_id":null}');
  assert.deepEqual(extractUsage(body), { in: 193, out: 11 });
  assert.equal(extractText({}), null);
});
