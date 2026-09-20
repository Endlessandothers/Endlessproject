// Agents building tools — Phase 3.
//
// This is the first phase where the platform writes code that the platform then
// runs. Every test here is about keeping the parties apart: the builder from the
// judge, the generator from the approver, and a new tool from a need that was
// already met.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  duplicateCheck, brief, validateGenerated, novelHosts, judgeView,
  DUPLICATE_FRACTION, GENERATED_MAX_SOURCE, GENERATED_RUNTIME, GENERATED_MAX_REQUESTS,
} from "../lambda/registry/builder.mjs";

const v = (query, tool_id) => ({ query, tool_id });

// ---------------------------------------------------------------- duplication
//
// PROJECT.md calls near-duplicate generation "the most likely failure", and it
// "inflates the world without adding to it".
test("nothing is generated when an existing tool already answers the need", () => {
  const d = duplicateCheck([v("a", "existing"), v("b", "existing"), v("c", null)]);
  assert.equal(d.generate, false);
  assert.equal(d.duplicate_of, "existing");
  assert.match(d.reason, /retrieval problem, not a missing tool/);
});

// The balance point. One query in three matching is NOT duplication — two
// thirds of the need is still absent, and refusing there would leave it absent.
test("a mostly-unmet need is built even though one query already matches", () => {
  const d = duplicateCheck([v("a", "existing"), v("b", null), v("c", null)]);
  assert.equal(d.generate, true);
  assert.ok(d.ratio < DUPLICATE_FRACTION);
});

// A clear majority is duplication: the remainder is a retrieval or description
// problem, and a second tool competing with the first fixes neither.
test("a mostly-answered need is refused as duplication", () => {
  const d = duplicateCheck([v("a", "existing"), v("b", "existing"), v("c", null)]);
  assert.equal(d.generate, false);
  assert.equal(d.duplicate_of, "existing");
});

test("a genuinely unmet need is built", () => {
  const d = duplicateCheck([v("a", null), v("b", null), v("c", null), v("d", null)]);
  assert.equal(d.generate, true);
  assert.equal(d.ratio, 0);
});

test("scattered single matches across different tools do not block generation", () => {
  // Four queries, three different tools answering one each. No single tool
  // covers the need, so the need is still unmet.
  const d = duplicateCheck([v("a", "x"), v("b", "y"), v("c", "z"), v("d", null),
                            v("e", null), v("f", null), v("g", null), v("h", null), v("i", null)]);
  assert.equal(d.generate, true);
  assert.equal(d.partial_matches, 3, "and the partial matches are still reported");
});

test("an empty cluster builds nothing", () => {
  assert.equal(duplicateCheck([]).generate, false);
});

// ---------------------------------------------------------------- the brief
test("the builder is given the cluster, never a single query", () => {
  const b = brief({ label: "read a pdf", queries: ["read a pdf", "extract dates from a pdf", "read a pdf"], distinct_callers: 4, spread_days: 9 });
  assert.deepEqual(b.queries, ["read a pdf", "extract dates from a pdf"], "deduplicated");
  assert.equal(b.distinct_callers, 4);
  assert.equal(b.sufficient, true);
});

// Who asked is nobody's business, including the builder's.
test("the brief carries counts and never identities", () => {
  const b = brief({
    label: "n", queries: ["q"], distinct_callers: 3,
    callers: [{ caller_id: "alice", owner: "a" }],
  });
  assert.equal(JSON.stringify(b).includes("alice"), false);
  assert.ok(!("callers" in b));
});

test("a cluster with no evidence behind it is not sufficient to build against", () => {
  assert.equal(brief({ label: "n", queries: [], distinct_callers: 0 }).sufficient, false);
  assert.equal(brief({ label: "n", queries: ["q"], distinct_callers: 0 }).sufficient, false);
});

// ---------------------------------------------------------------- the envelope
const good = () => ({
  handler_source: "export function transform({ responses }) { return responses.a.body; }",
  runtime: GENERATED_RUNTIME,
  requests: [{ id: "a", url: "https://api.example.com/x" }],
  allowlist: ["api.example.com"],
});

test("an ordinary generated package passes", () => {
  assert.deepEqual(validateGenerated(good()), []);
});

// Fargate is the runtime that leaves the free tier and bills per second.
test("a generated tool cannot ask for the expensive runtime", () => {
  const errors = validateGenerated({ ...good(), runtime: "fargate" });
  assert.ok(errors.some((e) => /lambda-vpc/.test(e)));
});

test("a generated handler is held to a tighter size limit than a person's", () => {
  const errors = validateGenerated({ ...good(), handler_source: "x".repeat(GENERATED_MAX_SOURCE + 1) });
  assert.ok(errors.some((e) => /limit is/.test(e)));
  // A person may publish 256 KB; this is deliberately far smaller, because a
  // reviewer reading code nobody wrote has less context to judge it with.
  assert.ok(GENERATED_MAX_SOURCE < 256 * 1024);
});

test("a generated tool may not fan out across many upstreams", () => {
  const requests = Array.from({ length: GENERATED_MAX_REQUESTS + 1 },
    (_, i) => ({ id: `r${i}`, url: "https://api.example.com/x" }));
  assert.ok(validateGenerated({ ...good(), requests }).some((e) => /exceeds the generated limit/.test(e)));
});

test("plain http is refused", () => {
  const errors = validateGenerated({ ...good(), requests: [{ id: "a", url: "http://api.example.com/x" }] });
  assert.ok(errors.some((e) => /https only/.test(e)));
});

test("a pure transform with no upstreams is a valid generated tool", () => {
  assert.deepEqual(validateGenerated({
    handler_source: "export function transform({ input }) { return input; }",
    runtime: GENERATED_RUNTIME, requests: [], allowlist: [],
  }), []);
});

// ---------------------------------------------------------------- review aids
test("hosts the registry has never approved are surfaced for the reviewer", () => {
  const pkg = { allowlist: ["api.new.com", "api.known.com"] };
  assert.deepEqual(novelHosts(pkg, ["api.known.com"]), ["api.new.com"]);
});

test("a novel host is surfaced, not refused", () => {
  // Reaching a new upstream is exactly what closing a novel gap requires. It is
  // the one claim in a generated package nothing else can check, so it goes in
  // front of a person rather than into a rule.
  const pkg = { allowlist: ["api.new.com"] };
  assert.equal(novelHosts(pkg, []).length, 1);
  assert.deepEqual(validateGenerated({ ...good(), allowlist: ["api.new.com"] }), []);
});

// ---------------------------------------------------------------- independence
//
// docs/deferred-corrections.md filed this against Phase 3: the adjudicator
// judging a tool the builder just generated is the system marking its own
// homework one level up.
test("the closure judge cannot tell a generated tool from any other", () => {
  const generated = {
    tool_id: "t", name: "T", description: "does a thing",
    provisional: true, generated_by: "builder", generated_at: "2026-09-20",
    cluster_id: "abc", model: "nova-pro",
  };
  const view = judgeView(generated);

  assert.deepEqual(Object.keys(view).sort(), ["description", "name", "tool_id"]);
  const serialised = JSON.stringify(view);
  for (const tell of ["provisional", "generated", "builder", "cluster", "nova"]) {
    assert.equal(serialised.includes(tell), false, `the judge must not see ${tell}`);
  }
});

test("a human tool and a generated tool look identical to the judge", () => {
  const base = { tool_id: "t", name: "T", description: "does a thing" };
  assert.deepEqual(
    judgeView({ ...base, owner: "a-person" }),
    judgeView({ ...base, owner: "builder", provisional: true }),
  );
});
