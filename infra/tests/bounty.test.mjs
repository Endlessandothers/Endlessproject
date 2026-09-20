// Bounties and anti-gaming — Phase 2, issues #6 and #7.
//
// A bounty is the first thing in Endless with money attached, and therefore the
// first thing worth gaming. Every counting rule in this system was written for
// a world with no prize in it, so these test the rules against a world that has
// one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { summarise } from "../lambda/cluster/cluster.mjs";
import {
  eligibility, closure, adoption, assessClaim,
  CLOSURE_FRACTION, MIN_INDEPENDENT_CALLERS,
} from "../lambda/cluster/bounty.mjs";
import {
  audit, similarOwners, concentratedCallers, narrowAdoption, ownedClusters,
  NARROW_ADOPTION_CALLERS, CONCENTRATION_MIN_CALLS,
} from "../lambda/cluster/audit.mjs";

const NEAR = [1, 0, 0];
const gap = (over = {}) => ({
  query: "a need", vector: NEAR, actor_verified: true,
  caller_id: "c", owner: "o", ts: "2026-09-01T00:00:00Z",
  caller_created_at: "2026-01-01T00:00:00Z", ...over,
});
const spread = (i) => `2026-09-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`;

// ---------------------------------------------------------------- eligibility
//
// The rule that removes the payoff rather than trying to detect intent.
test("a need built entirely by the claimant pays nothing", () => {
  const members = Array.from({ length: 12 }, (_, i) =>
    gap({ caller_id: `k${i}`, owner: "mallory", ts: spread(i) }));
  const e = eligibility(summarise(members), "mallory");

  assert.equal(e.eligible, false);
  assert.equal(e.net_callers, 0);
  assert.equal(e.excluded_callers, 12);
  // NOT flagged manufactured, and that is correct: the distinct-owner rule
  // refused it before beneficiary exclusion was reached. Twelve keys held by
  // one person were never one need with twelve people behind it, so it never
  // reached the board to be taken off it.
  assert.equal(e.manufactured, false);
});

// The realistic shape. A claimant does not build a whole need; they tip a
// nearly-real one over the line, then close it.
test("a need the claimant tipped over the line is flagged manufactured", () => {
  const members = [
    ...Array.from({ length: 2 }, (_, i) => gap({ caller_id: `r${i}`, owner: `real-${i}`, ts: spread(i) })),
    ...Array.from({ length: 3 }, (_, i) => gap({ caller_id: `m${i}`, owner: "mallory", ts: spread(i + 8) })),
  ];
  const e = eligibility(summarise(members), "mallory");
  assert.equal(e.eligible, false, "two genuine owners is below the bar");
  assert.equal(e.manufactured, true, "it qualified only because the claimant was in it");
});

// THE LIMIT, stated as a test so it cannot be forgotten.
//
// Exclusion removes ONE owner. A claimant who built the demand under several
// owner identities loses only the one they claim under, and the rest survives
// as evidence. Every distinct-owner rule in this system rests on one party
// being unable to cheaply become several, and minting a caller still costs
// nothing — so this is not a hole in exclusion, it is that open decision
// arriving where the money is.
test("beneficiary exclusion does not survive a claimant with several identities", () => {
  const members = [
    ...Array.from({ length: 3 }, (_, i) =>
      gap({ caller_id: `sock-${i}`, owner: `mallory-alt-${i}`, ts: spread(i) })),
    ...Array.from({ length: 2 }, (_, i) =>
      gap({ caller_id: `m${i}`, owner: "mallory", ts: spread(i + 10) })),
  ];
  const e = eligibility(summarise(members), "mallory");
  assert.equal(e.excluded_callers, 2, "only the claiming identity is removed");
  assert.equal(e.eligible, true,
    "and the three sock puppets still read as three separate people");
});

test("a real need survives the claimant being removed from it", () => {
  const members = [
    ...Array.from({ length: 4 }, (_, i) => gap({ caller_id: `m${i}`, owner: "mallory", ts: spread(i) })),
    ...Array.from({ length: 5 }, (_, i) => gap({ caller_id: `r${i}`, owner: `real-${i}`, ts: spread(i + 10) })),
  ];
  const e = eligibility(summarise(members), "mallory");
  assert.equal(e.eligible, true);
  assert.equal(e.excluded_callers, 4);
  assert.equal(e.net_callers, 5);
  assert.equal(e.manufactured, false);
});

test("a claimant who contributed nothing loses nothing", () => {
  const members = Array.from({ length: 5 }, (_, i) =>
    gap({ caller_id: `r${i}`, owner: `real-${i}`, ts: spread(i) }));
  const e = eligibility(summarise(members), "an-outsider");
  assert.equal(e.excluded_callers, 0);
  assert.equal(e.eligible, true);
});

// ---------------------------------------------------------------- closure
const v = (query, tool_id) => ({ query, tool_id });

test("closure is judged per query by the adjudicator, not by a score", () => {
  const c = closure([v("a", "new"), v("b", "new"), v("c", "new"), v("d", "new"), v("e", null)], "new");
  assert.equal(c.closed, true);
  assert.equal(c.ratio, 0.8);
  assert.deepEqual(c.still_unmet, ["e"]);
});

test("a partial closure is visibly partial", () => {
  const c = closure([v("a", "new"), v("b", null), v("c", null)], "new");
  assert.equal(c.closed, false);
  assert.equal(c.still_unmet.length, 2, "what survived is named, not rounded away");
});

// If something else answers the queries, the need was met and the gap was a
// retrieval failure — which is a finding about search, not a bounty.
test("queries answered by another tool are reported, not counted", () => {
  const c = closure([v("a", "existing"), v("b", "existing"), v("c", "new")], "new");
  assert.equal(c.closed, false);
  assert.equal(c.answered_by_others.length, 2);
  assert.equal(c.answered_by_others[0].tool_id, "existing");
});

test("an empty verdict set closes nothing", () => {
  assert.equal(closure([], "new").closed, false);
});

// ---------------------------------------------------------------- adoption
test("publishing is not closing: a bounty waits for independent use", () => {
  const a = adoption({ distinct_callers: 0, distinct_owners: 0 }, "mallory");
  assert.equal(a.adopted, false);
  assert.equal(a.needed, MIN_INDEPENDENT_CALLERS);
});

test("use by the claimant alone is not adoption", () => {
  const a = adoption({ distinct_callers: 9, distinct_owners: 1, only_owner: "mallory" }, "mallory");
  assert.equal(a.adopted, false, "nine of your own keys is not nine users");
});

test("use by enough separate callers is adoption", () => {
  assert.equal(adoption({ distinct_callers: MIN_INDEPENDENT_CALLERS, distinct_owners: 3 }, "m").adopted, true);
});

// ---------------------------------------------------------------- the whole claim
const realNeed = () => summarise([
  ...Array.from({ length: 5 }, (_, i) => gap({ caller_id: `r${i}`, owner: `real-${i}`, ts: spread(i) })),
]);

test("a claim fails at eligibility before anything else is checked", () => {
  const manufactured = summarise(Array.from({ length: 9 }, (_, i) =>
    gap({ caller_id: `k${i}`, owner: "mallory", ts: spread(i) })));
  const r = assessClaim({
    summary: manufactured, claimantOwner: "mallory",
    verdicts: [v("a", "tool")], toolId: "tool",
    row: { distinct_callers: 50, distinct_owners: 50 },
  });
  assert.equal(r.award, false);
  assert.equal(r.stage, "eligibility",
    "a manufactured need is not worth running a closure test on");
});

test("a claim that closes but is unused is pending, not refused", () => {
  const r = assessClaim({
    summary: realNeed(), claimantOwner: "outsider",
    verdicts: [v("a", "tool"), v("b", "tool")], toolId: "tool",
    row: { distinct_callers: 0, distinct_owners: 0 },
  });
  assert.equal(r.award, false);
  assert.equal(r.stage, "adoption");
  assert.equal(r.pending, true, "a claim that will probably pay next month is not a refusal");
});

test("a real need, genuinely closed and genuinely used, pays", () => {
  const r = assessClaim({
    summary: realNeed(), claimantOwner: "outsider",
    verdicts: [v("a", "tool"), v("b", "tool"), v("c", "tool"), v("d", "tool"), v("e", null)],
    toolId: "tool",
    row: { distinct_callers: 6, distinct_owners: 6, brightness: 0.8 },
  });
  assert.equal(r.award, true);
  assert.equal(r.closure.ratio, CLOSURE_FRACTION);
});

// ---------------------------------------------------------------- audit
test("owner strings that differ only by punctuation are surfaced", () => {
  assert.deepEqual(similarOwners(["Acme Ltd", "acme-ltd", "other"]), [["Acme Ltd", "acme-ltd"]]);
});

// The Phase 1 defect, and the honest limit of this check.
test("the audit does not claim to solve owner identity", () => {
  // "erics" and "ericsonasamoah3" are the same person and do NOT normalise
  // together. This check reports candidates; it does not fix the problem.
  assert.deepEqual(similarOwners(["erics", "ericsonasamoah3"]), []);
});

test("a caller sending nearly all its traffic to one owner is flagged", () => {
  const events = Array.from({ length: CONCENTRATION_MIN_CALLS }, () =>
    ({ type: "call", caller_id: "puppet", tool_id: "t" }));
  const flags = concentratedCallers(events, new Map([["t", "mallory"]]));
  assert.equal(flags.length, 1);
  assert.equal(flags[0].ratio, 1);
});

test("a caller with too little traffic to judge is not flagged", () => {
  const events = [{ type: "call", caller_id: "new-user", tool_id: "t" }];
  assert.deepEqual(concentratedCallers(events, new Map([["t", "mallory"]])), []);
});

test("mass resting on very few callers is surfaced", () => {
  const flags = narrowAdoption([
    { tool_id: "narrow", mass: 500, distinct_callers: 1, distinct_owners: 1 },
    { tool_id: "broad", mass: 500, distinct_callers: 40, distinct_owners: 40 },
    { tool_id: "unused", mass: 0, distinct_callers: 0, distinct_owners: 0 },
  ]);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].tool_id, "narrow");
  assert.ok(NARROW_ADOPTION_CALLERS > 1);
});

test("an owner holding most of a competition cluster is surfaced", () => {
  const owners = new Map([["a", "mallory"], ["b", "mallory"], ["c", "someone"]]);
  const flags = ownedClusters([["a", "b", "c"]], owners);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].owner, "mallory");
  assert.equal(flags[0].holds, 2);
});

test("the audit reports flags and never a verdict", () => {
  const out = audit({
    rows: [{ tool_id: "t", mass: 10, distinct_callers: 1, distinct_owners: 1, ownership_verified: false }],
    events: [], clusters: [], tools: [{ tool_id: "t", owner: "mallory" }],
  });
  assert.ok(out.flag_count >= 1);
  assert.ok(!("blocked" in out) && !("verdict" in out));
  assert.match(out.note, /not verdicts/);
  assert.match(out.note, /minting a caller still costs nothing/);
});
