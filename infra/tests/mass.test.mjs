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

// ---------------------------------------------------------------- brightness
//
// Phase 2, issue #2. Quality kept apart from popularity.

import { wilsonLowerBound, brightnessOf, dependencyWeights, DEPENDENCY_DAMPING } from "../lambda/cluster/mass.mjs";

// The property a raw success rate gets wrong, and the whole reason for Wilson:
// a tool that has succeeded once must not outrank one that has succeeded a
// hundred times out of a hundred and one.
test("brightness requires evidence, not a lucky first call", () => {
  const novice = wilsonLowerBound(1, 1);
  const proven = wilsonLowerBound(100, 101);
  assert.ok(novice < 0.5, `one-for-one should not look excellent, got ${novice}`);
  assert.ok(proven > novice, "a long record must beat a short perfect one");
});

test("brightness rises with evidence at a fixed success rate", () => {
  const a = wilsonLowerBound(9, 10);
  const b = wilsonLowerBound(90, 100);
  const c = wilsonLowerBound(900, 1000);
  assert.ok(a < b && b < c, `expected increasing confidence, got ${a}, ${b}, ${c}`);
  assert.ok(c < 0.9, "and it never reaches the raw rate");
});

test("brightness is bounded and handles the degenerate cases", () => {
  assert.equal(wilsonLowerBound(0, 0), 0);
  assert.equal(wilsonLowerBound(0, 10), 0);
  for (const [s, t] of [[1, 1], [5, 10], [99, 100]]) {
    const v = wilsonLowerBound(s, t);
    assert.ok(v >= 0 && v <= 1, `${s}/${t} out of range: ${v}`);
  }
});

test("a tool that always fails is dark, not unrated", () => {
  const b = brightnessOf([call({ outcome: "error" }), call({ outcome: "error" })]);
  assert.equal(b.brightness, 0);
});

test("a tool nobody has called has no brightness rather than zero", () => {
  // Zero would read as "known to be bad". Null reads as "not yet known", which
  // is the true statement.
  assert.equal(brightnessOf([]).brightness, null);
});

test("satisfaction is named as absent rather than quietly dropped", () => {
  assert.equal(brightnessOf([call()]).satisfaction, null);
  assert.equal(brightnessOf([call()]).brightness_basis, "wilson-lower-bound-95");
});

// ---------------------------------------------------------------- dependency weight
//
// Phase 2, issue #3, and the anti-gaming half of #6 that could not wait.

const dep = (over = {}) => call({ via_tool: "parent", ...over });

test("a call arriving via another tool is not mass", () => {
  const m = massOf([call(), dep(), dep()]);
  assert.equal(m.mass, 1, "only the direct call is demand");
  assert.equal(m.calls_via_tools, 2);
});

test("weight flows from a dependent's own direct mass", () => {
  const events = [
    // "popular" was chosen directly ten times.
    ...Array.from({ length: 10 }, () => call({ tool_id: "popular" })),
    // and each time it used "engine".
    ...Array.from({ length: 10 }, () => call({ tool_id: "engine", via_tool: "popular" })),
  ];
  const w = dependencyWeights([{ tool_id: "engine", owner: "a" }, { tool_id: "popular", owner: "b" }], events);
  assert.equal(w.get("engine").dependents, 1);
  assert.equal(w.get("engine").dependency_weight, 10 * DEPENDENCY_DAMPING);
  assert.equal(w.get("popular").dependency_weight, 0, "nothing was built on popular");
});

// The cheap attack, and why it fails without needing to be detected.
test("publishing unused tools that depend on yours is worth nothing", () => {
  const events = Array.from({ length: 5 }, (_, i) =>
    call({ tool_id: "engine", via_tool: `shell-${i}` }));
  const tools = [{ tool_id: "engine", owner: "victim" },
                 ...Array.from({ length: 5 }, (_, i) => ({ tool_id: `shell-${i}`, owner: "mallory" }))];
  const w = dependencyWeights(tools, events);
  assert.equal(w.get("engine").dependency_weight, 0,
    "five dependents with no direct mass of their own contribute nothing");
});

// THE NEW SURFACE the Phase 2 deck names: the self-call rule covers an owner
// CALLING their own tool and says nothing about an owner DEPENDING on it.
test("an owner cannot earn standing by depending on their own tool", () => {
  const events = [
    ...Array.from({ length: 20 }, () => call({ tool_id: "front", owner: "stranger" })),
    ...Array.from({ length: 20 }, () => call({ tool_id: "engine", via_tool: "front", owner: "stranger" })),
  ];
  const sameOwner = dependencyWeights(
    [{ tool_id: "engine", owner: "mallory" }, { tool_id: "front", owner: "mallory" }], events);
  assert.equal(sameOwner.get("engine").dependency_weight, 0);
  assert.equal(sameOwner.get("engine").self_dependents_excluded, 1);

  // The same traffic, from a dependent somebody else owns, counts.
  const different = dependencyWeights(
    [{ tool_id: "engine", owner: "mallory" }, { tool_id: "front", owner: "someone-else" }], events);
  assert.equal(different.get("engine").dependency_weight, 20 * DEPENDENCY_DAMPING);
  assert.equal(different.get("engine").self_dependents_excluded, 0);
});

test("the graph is read from calls, not from declarations", () => {
  // Declaring a dependency is free. Being built upon is not.
  const w = dependencyWeights([{ tool_id: "engine", owner: "a" }], []);
  assert.equal(w.get("engine").dependents, 0);
  assert.equal(w.get("engine").dependency_weight, 0);
});

test("unverified and self calls build no graph edges", () => {
  const events = [
    call({ tool_id: "engine", via_tool: "front", actor_verified: false }),
    call({ tool_id: "engine", via_tool: "front", self_call: true }),
  ];
  const w = dependencyWeights([{ tool_id: "engine", owner: "a" }, { tool_id: "front", owner: "b" }], events);
  assert.equal(w.get("engine").dependents, 0);
});

test("scoreTools reports mass, brightness and weight without blending them", () => {
  const events = [
    ...Array.from({ length: 4 }, () => call({ tool_id: "front", owner: "s" })),
    ...Array.from({ length: 4 }, () => call({ tool_id: "engine", via_tool: "front", owner: "s" })),
  ];
  const [top] = scoreTools([{ tool_id: "front", owner: "a" }, { tool_id: "engine", owner: "b" }], events);
  assert.equal(top.tool_id, "front");
  const engine = scoreTools([{ tool_id: "front", owner: "a" }, { tool_id: "engine", owner: "b" }], events)
    .find((r) => r.tool_id === "engine");
  assert.equal(engine.mass, 0, "engine was never chosen directly");
  assert.ok(engine.dependency_weight > 0, "but it was built upon");
  assert.ok(engine.brightness > 0, "and it worked every time it ran");
  // Still no paid input anywhere in the row.
  assert.doesNotThrow(() => assertNoPaidInputs(engine));
});

// Found by reading a live score, not by reasoning about it: an owner's own tool
// showed brightness 0 with four attempts, because its successful self-calls were
// excluded from mass while its failures still counted against quality. The flag
// is now written on every event, so the two halves agree.
test("a self call is excluded from brightness as well as from mass", () => {
  const events = [
    call({ self_call: true }),
    call({ self_call: true }),
    call({ self_call: true, outcome: "error" }),
  ];
  const m = massOf(events);
  assert.equal(m.mass, 0, "own calls are not demand");
  assert.equal(m.attempts, 0, "and own failures are not evidence of unreliability");
  assert.equal(m.brightness, null, "so there is nothing known about quality yet");
  assert.equal(m.self_calls_excluded, 3);
});

test("a failure by somebody else still darkens a tool", () => {
  const m = massOf([call({ self_call: true }), call({ outcome: "error" })]);
  assert.equal(m.attempts, 1);
  assert.equal(m.brightness, 0);
});

// The quarantine covers gaps AND scores. tools.json is a public claim about
// what people use; a number inflated by a test harness is the same lie as a
// manufactured gap, so it has to cover both surfaces or it covers neither.
test("simulated traffic earns no mass, no brightness and no weight", () => {
  const events = [
    ...Array.from({ length: 20 }, () => call({ tool_id: "front", simulated: true })),
    ...Array.from({ length: 20 }, () => call({ tool_id: "engine", via_tool: "front", simulated: true })),
  ];
  const [front, engine] = scoreTools(
    [{ tool_id: "front", owner: "a" }, { tool_id: "engine", owner: "b" }], events)
    .sort((x, y) => x.tool_id.localeCompare(y.tool_id) * -1);
  assert.equal(front.mass, 0);
  assert.equal(front.simulated_excluded, 20);
  assert.equal(engine.dependency_weight, 0, "and it builds no graph either");
  assert.equal(engine.brightness, null);
});
