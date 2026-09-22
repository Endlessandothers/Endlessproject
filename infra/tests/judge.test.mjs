// The gap adjudicator, now on Claude through the Anthropic API.
//
// The parser got simpler when the model moved: a server-validated schema
// replaced fence-stripping and prose-tolerance, so those tests are gone rather
// than kept passing against code that no longer does that work. What survived
// is everything about failing safely, which the schema does not cover.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPrompt, buildRequest, parseVerdict, extractText, extractUsage,
  SYSTEM_PROMPT, VERDICT_FORMAT,
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

test("the request carries the system prompt and one user message", () => {
  const r = buildRequest("q", CANDS, { model: "claude-opus-5" });
  assert.equal(r.system, SYSTEM_PROMPT);
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].role, "user");
  assert.equal(r.model, "claude-opus-5");
});

// A three-way classification over three short descriptions does not need deep
// thinking, and the first deployed version took 13.3 seconds per search
// because it did it anyway — billed as Lambda time as well as tokens.
test("the judge runs at low effort", () => {
  assert.equal(buildRequest("q", CANDS, {}).output_config.effort, "low");
});

// The format object takes {type, schema} and nothing else. `name` and
// `description` are both rejected as "Extra inputs are not permitted" — which
// cost a deploy of the judge silently falling back to the threshold it exists
// to replace.
test("the response format carries no fields the API refuses", () => {
  assert.deepEqual(Object.keys(VERDICT_FORMAT).sort(), ["schema", "type"]);
  assert.equal(VERDICT_FORMAT.type, "json_schema");
  assert.equal(VERDICT_FORMAT.schema.additionalProperties, false);
});

test("parses a verdict naming a candidate", () => {
  assert.deepEqual(parseVerdict('{"tool_id":"weather-forecast"}', IDS),
    { ok: true, tool_id: "weather-forecast", reason: "match" });
});

test("parses a null verdict as a genuine gap", () => {
  const v = parseVerdict('{"tool_id": null}', IDS);
  assert.equal(v.ok, true);
  assert.equal(v.tool_id, null);
});

// A schema constrains the shape, not the contents: "some string" is valid
// against `type: ["string","null"]` whether or not that string names a real
// tool. This is the check the schema cannot make.
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

test("extractText and extractUsage read the Anthropic message shape", () => {
  const message = {
    content: [{ type: "text", text: '{"tool_id":null}' }],
    usage: { input_tokens: 539, output_tokens: 11 },
  };
  assert.equal(extractText(message), '{"tool_id":null}');
  assert.deepEqual(extractUsage(message), { in: 539, out: 11 });
  assert.equal(extractText({}), null);
  assert.deepEqual(extractUsage({}), { in: 0, out: 0 });
});

// Thinking blocks arrive alongside text and must not be concatenated into the
// verdict, which would make it unparseable and send a working judge to the
// threshold.
test("non-text blocks are ignored when reading the verdict", () => {
  const message = {
    content: [
      { type: "thinking", thinking: "" },
      { type: "text", text: '{"tool_id":"weather-forecast"}' },
    ],
  };
  assert.equal(parseVerdict(extractText(message), IDS).tool_id, "weather-forecast");
});
