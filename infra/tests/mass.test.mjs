// Phase 1, issue #10 — mass-only scoring.
//
// These test the ranking claims, not an algorithm. Invariant #3 says money
// never touches ranking; these are what make that checkable rather than stated.

import { test } from "node:test";
import assert from "node:assert/strict";
import { massOf, scoreTools, isCountable, assertNoPaidInputs } from "../lambda/cluster/mass.mjs";

const call = (over = {}) => ({
  type: "call",
  tool_id: "t1",
  outcome: "success",
  caller_id: "c1",
  owner: "o1",
  actor_verified: true,
  self_call: false,
  ms: 100,
  ts: "2026-09-01T00:00:00Z",
  ...over,
});

test("mass is successful calls, and failures are reported rather than hidden", () => {
  const m = massOf([
    call(), call(), call({ outcome: "error" }), call({ outcome: "error" }),
  ]);
  assert.equal(m.mass, 2);
  assert.equal(m.attempts, 4);
  assert.equal(m.failures, 2);
  assert.equal(m.success_rate, 0.5);
});

// The wash-trading guard, at the scoring end. Metering makes fake demand cost
// money, which also makes usage purchasable — and mass is computed from usage.
test("a tool owner calling their own tool adds no mass", () => {
  const m = massOf([
    call({ self_call: true }), call({ self_call: true }), call(),
  ]);
  assert.equal(m.mass, 1);
  assert.equal(m.self_calls_excluded, 2);
});

test("unverified calls add no mass and are counted separately", () => {
  const m = massOf([
    call({ actor_verified: false }), call({ actor_verified: undefined }), call(),
  ]);
  assert.equal(m.mass, 1);
  assert.equal(m.unverified_excluded, 2);
});

test("one caller in a loop is visibly different from many callers", () => {
  const loop = massOf(Array.from({ length: 50 }, () => call()));
  const crowd = massOf(Array.from({ length: 50 }, (_, i) =>
    call({ caller_id: `c${i}`, owner: `o${i}` })));

  // Raw mass is the same. The distinction is what makes them separable, and
  // Phase 2 has to choose between them against real data rather than now.
  assert.equal(loop.mass, crowd.mass);
  assert.equal(loop.distinct_callers, 1);
  assert.equal(crowd.distinct_callers, 50);
});

test("ten keys held by one person are ten callers but one owner", () => {
  const m = massOf(Array.from({ length: 10 }, (_, i) =>
    call({ caller_id: `key-${i}`, owner: "mallory" })));
  assert.equal(m.distinct_callers, 10);
  assert.equal(m.distinct_owners, 1);
});

test("latency percentiles come from successful calls only", () => {
  const m = massOf([
    call({ ms: 10 }), call({ ms: 20 }), call({ ms: 30 }),
    // A fast failure must not flatter the p50.
    call({ ms: 1, outcome: "error" }),
  ]);
  assert.equal(m.p50_ms, 20);
  assert.ok(m.p95_ms >= 20);
});

test("events that are not calls are ignored", () => {
  assert.equal(isCountable({ type: "search", actor_verified: true }), false);
  assert.equal(massOf([{ type: "search", actor_verified: true }]).mass, 0);
});

// A registry that only lists what has been used cannot show what has not.
test("a tool nobody has called is ranked, at zero, not omitted", () => {
  const rows = scoreTools(["used", "never-used"], [call({ tool_id: "used" })]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].tool_id, "used");
  assert.equal(rows.at(-1).tool_id, "never-used");
  assert.equal(rows.at(-1).mass, 0);
  assert.equal(rows.at(-1).first_call, null);
});

test("ranking is stable when mass ties", () => {
  const events = [call({ tool_id: "b" }), call({ tool_id: "a" })];
  const once = scoreTools(["a", "b"], events).map((r) => r.tool_id);
  const twice = scoreTools(["b", "a"], events).map((r) => r.tool_id);
  assert.deepEqual(once, twice, "input order must not change the ranking");
});

test("calls for an unknown tool do not invent a row", () => {
  const rows = scoreTools(["a"], [call({ tool_id: "ghost" })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mass, 0);
});

// ---------------------------------------------------------------- invariant #3
test("a ranking input that came from money is refused", () => {
  assert.doesNotThrow(() => assertNoPaidInputs({ tool_id: "t", mass: 5 }));
  for (const bad of [
    { mass: 5, credits: 100 },
    { mass: 5, sponsored_rank: 1 },
    { mass: 5, expedited: true },
    { mass: 5, price_paid: 3 },
  ]) {
    assert.throws(() => assertNoPaidInputs(bad), /derived from payment/);
  }
});

test("every scored row passes the no-paid-inputs check", () => {
  // The real guard: whatever massOf grows in future is checked automatically.
  for (const row of scoreTools(["a", "b"], [call({ tool_id: "a" })])) {
    assert.doesNotThrow(() => assertNoPaidInputs(row));
  }
});

// ---------------------------------------------------------------- ownership
//
// Found live, not by reasoning: air-quality carried owner "ericsonasamoah3"
// while the caller invoking it carried "erics". Same person, two strings, so
// the self-call guard compared them and did not fire. The mass was wrong and
// nothing errored. Ownership is verified at publication now; what came before
// cannot be repaired, so it is reported.
test("ownership is only trustworthy when it was verified at publication", async () => {
  const { ownershipTrustworthy } = await import("../lambda/cluster/mass.mjs");
  assert.equal(ownershipTrustworthy({ owner: "erics", owner_verified: true }), true);
  assert.equal(ownershipTrustworthy({ owner: "erics" }), false);
  assert.equal(ownershipTrustworthy({ owner: "erics", owner_verified: "yes" }), false);
  assert.equal(ownershipTrustworthy(null), false);
});

test("two spellings of one owner are not treated as the same owner", () => {
  // This is the defect itself, pinned. The guard works on exact equality and
  // cannot do otherwise, which is why the flag above exists.
  const m = massOf([
    call({ owner: "erics", self_call: false }),
    call({ owner: "ericsonasamoah3", self_call: false }),
  ]);
  assert.equal(m.distinct_owners, 2, "exact string equality is the rule, and its limit");
  assert.equal(m.self_calls_excluded, 0);
});
