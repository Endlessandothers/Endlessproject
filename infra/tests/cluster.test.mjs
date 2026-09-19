// Phase 1, issues #8 and #9 — the counting rules.
//
// These are not tests of an algorithm. They are tests of the claims the gaps
// board will make in public, and each one corresponds to a rule in
// docs/phase-1-gap-clustering.md. If one of these fails, the board is lying.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cluster, cosine, summarise, excludeBeneficiary, assess, RULE,
} from "../lambda/cluster/cluster.mjs";

// Vectors built by hand so similarity is exact and the tests do not depend on
// an embedding model being reachable or unchanged.
const v = (...xs) => xs;
const NEAR_A = v(1, 0, 0);
const NEAR_B = v(0.98, 0.2, 0);
const FAR = v(0, 0, 1);

const gap = (over = {}) => ({
  gap_id: Math.random().toString(36).slice(2),
  query: "a question",
  vector: NEAR_A,
  caller_id: "c1",
  owner: "o1",
  actor_verified: true,
  ts: "2026-09-01T00:00:00Z",
  caller_created_at: "2026-01-01T00:00:00Z",
  ...over,
});

test("similar queries land in one cluster and dissimilar ones do not", () => {
  const groups = cluster([
    gap({ vector: NEAR_A }), gap({ vector: NEAR_B }), gap({ vector: FAR }),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.length).sort(), [1, 2]);
});

test("a gap with no vector is dropped rather than silently clustered", () => {
  // A gap logged before vectors were stored has no meaning to cluster BY.
  // Grouping it anyway would put it wherever the first comparison landed.
  const groups = cluster([gap({ vector: NEAR_A }), gap({ vector: undefined })]);
  assert.equal(groups.flat().length, 1);
});

// ---------------------------------------------------------------- the one rule
//
// This is the whole point. Everything else is corroboration.
test("one caller asking a hundred times counts once", () => {
  const spam = Array.from({ length: 100 }, (_, i) => gap({
    caller_id: "manufacturer", owner: "mallory",
    query: `rephrased question number ${i}`,
    ts: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
  }));
  const s = summarise(spam);
  assert.equal(s.distinct_callers, 1);
  assert.equal(s.occurrences, 100);
  assert.equal(assess(s).confirmed, false);
});

test("ten callers asking once each counts ten", () => {
  const real = Array.from({ length: 10 }, (_, i) => gap({
    caller_id: `caller-${i}`, owner: `owner-${i}`,
    ts: `2026-09-0${(i % 9) + 1}T00:00:00Z`,
  }));
  const s = summarise(real);
  assert.equal(s.distinct_callers, 10);
  assert.equal(assess(s).confirmed, true);
});

// The sybil shape: many keys, one person behind them.
test("many callers owned by one person do not become many owners", () => {
  const sybil = Array.from({ length: 12 }, (_, i) => gap({
    caller_id: `key-${i}`, owner: "mallory",
    ts: `2026-09-0${(i % 9) + 1}T00:00:00Z`,
  }));
  const s = summarise(sybil);
  assert.equal(s.distinct_callers, 12);
  assert.equal(s.distinct_owners, 1);
  const verdict = assess(s);
  assert.equal(verdict.confirmed, false, "twelve keys held by one owner must not confirm a gap");
  assert.ok(verdict.flags.some((f) => /callers but only/.test(f)));
});

test("unverified rows are counted separately and never as demand", () => {
  const s = summarise([
    gap({ caller_id: "c1", owner: "o1" }),
    // Pre-identity rows. Kept visible, excluded from every count.
    { query: "old", vector: NEAR_A, actor_verified: false, ts: "2026-08-01T00:00:00Z" },
    { query: "older", vector: NEAR_A, ts: "2026-08-01T00:00:00Z" },
  ]);
  assert.equal(s.distinct_callers, 1);
  assert.equal(s.occurrences, 3);
  assert.equal(s.unverified_occurrences, 2);
});

// ---------------------------------------------------------------- corroboration
test("time spread is measured, and a burst fails the spread gate", () => {
  const burst = Array.from({ length: 5 }, (_, i) => gap({
    caller_id: `c${i}`, owner: `o${i}`,
    ts: `2026-09-01T00:0${i}:00Z`,
  }));
  const s = summarise(burst);
  assert.ok(s.spread_days < 1);
  const verdict = assess(s);
  assert.equal(verdict.confirmed, false);
  assert.ok(verdict.withheld_because.some((r) => /days/.test(r)));
});

// Age is measured AT THE MOMENT OF ASKING. Measuring it today would let a
// manufactured cluster launder itself by simply waiting.
test("caller age is measured when they asked, not now", () => {
  const fresh = Array.from({ length: 4 }, (_, i) => gap({
    caller_id: `c${i}`, owner: `o${i}`,
    caller_created_at: "2026-08-30T00:00:00Z",   // two days before asking
    ts: `2026-09-0${i + 1}T00:00:00Z`,
  }));
  const s = summarise(fresh);
  assert.ok(s.median_caller_age_days < RULE.young_caller_days);
  const verdict = assess(s);
  // Flagged, not blocked: a genuine rush of new users looks exactly like this.
  assert.equal(verdict.confirmed, true);
  assert.ok(verdict.flags.some((f) => /days old/.test(f)));
});

// ---------------------------------------------------------------- exclusion
test("the closer's own demand does not count toward their bounty", () => {
  const members = [
    ...Array.from({ length: 8 }, (_, i) => gap({ caller_id: `m${i}`, owner: "mallory", ts: `2026-09-0${(i % 9) + 1}T00:00:00Z` })),
    ...Array.from({ length: 4 }, (_, i) => gap({ caller_id: `r${i}`, owner: `real-${i}`, ts: `2026-09-1${i}T00:00:00Z` })),
  ];
  const s = summarise(members);
  assert.equal(s.distinct_callers, 12);

  // Mallory publishes the tool that closes it. Her eight votes evaporate.
  const net = excludeBeneficiary(s, "mallory");
  assert.equal(net.distinct_callers, 4);
  assert.equal(net.excluded_callers, 8);
  assert.equal(assess(net).confirmed, true, "four unrelated callers still make it real");

  // And if the demand was ALL hers, nothing is left.
  const allHers = excludeBeneficiary(summarise(members.slice(0, 8)), "mallory");
  assert.equal(allHers.distinct_callers, 0);
  assert.equal(assess(allHers).confirmed, false);
});

test("exclusion with no beneficiary changes nothing", () => {
  const s = summarise([gap()]);
  assert.deepEqual(excludeBeneficiary(s, null), s);
});

test("a label is chosen without a model, by how many asked it", () => {
  const s = summarise([
    gap({ query: "asked once" }),
    gap({ query: "asked twice", caller_id: "c2", owner: "o2" }),
    gap({ query: "asked twice", caller_id: "c3", owner: "o3" }),
  ]);
  assert.equal(s.label, "asked twice");
});

test("an empty cluster summarises without dividing by zero", () => {
  const s = summarise([]);
  assert.equal(s.distinct_callers, 0);
  assert.equal(s.spread_days, 0);
  assert.equal(s.median_caller_age_days, null);
  assert.equal(assess(s).confirmed, false);
});

test("cosine handles mismatched and empty vectors without throwing", () => {
  assert.equal(cosine([1, 0], [1, 0, 0]), 0);
  assert.equal(cosine(null, [1]), 0);
  assert.equal(cosine([0, 0], [0, 0]), 0);
});
