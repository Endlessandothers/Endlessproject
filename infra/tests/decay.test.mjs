// Decay and the archival floor — Phase 2, issue #4.
//
// Decay is the mechanism that can quietly delete the registry, so these test
// the cases where an absolute half-life gets it wrong: seasonal tools, quiet
// niches, and a single call used to resurrect something dead.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  competitionClusters, standingOf, decayedMass, archiveState, decayOf,
  BASE_HALF_LIFE_DAYS, STANDING_FLOOR, MIN_CO_RETRIEVAL_CALLERS, COMPETE_TOP_N,
} from "../lambda/cluster/decay.mjs";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-20T00:00:00Z");
const daysAgo = (n) => NOW - n * DAY;
let probe = 0;
// Every search carries a caller, because the graph is built from distinct
// callers rather than from occurrences.
const search = (...ranked) => ({ ranked, caller_id: `c${probe++}`, actor_verified: true });
const searchBy = (caller, ...ranked) => ({ ranked, caller_id: caller, actor_verified: true });

// ---------------------------------------------------------------- competition
test("tools that keep appearing together compete", () => {
  const events = Array.from({ length: MIN_CO_RETRIEVAL_CALLERS }, () => search("a", "b", "c"));
  const [cluster] = competitionClusters(events);
  assert.deepEqual(cluster, ["a", "b", "c"]);
});

// One shared shortlist is a coincidence, and it is also the whole budget an
// attacker needs if the threshold is one.
test("a single co-appearance is not a rivalry", () => {
  assert.deepEqual(competitionClusters([search("a", "b")]), []);
});

// THE ATTACK, found by building the graph and noticing I had built it: nine
// searches from one caller produced a cluster. Craft queries returning your
// rival beside a tool that dominates, repeat, and the rival's half-life drops
// tenfold. Search traffic is free, so doing it costs nothing.
test("one caller cannot decide who competes, however hard they search", () => {
  const events = Array.from({ length: 500 }, () => searchBy("mallory", "rival", "giant"));
  assert.deepEqual(competitionClusters(events), [],
    "five hundred searches from one caller build no edge");
});

test("separate callers seeing the same pair do build an edge", () => {
  const events = Array.from({ length: MIN_CO_RETRIEVAL_CALLERS },
    (_, i) => searchBy(`person-${i}`, "rival", "giant"));
  assert.deepEqual(competitionClusters(events), [["giant", "rival"]]);
});

test("unverified and simulated searches build no edges", () => {
  const unverified = Array.from({ length: 10 },
    (_, i) => ({ ranked: ["a", "b"], caller_id: `c${i}`, actor_verified: false }));
  const simulated = Array.from({ length: 10 },
    (_, i) => ({ ranked: ["a", "b"], caller_id: `c${i}`, actor_verified: true, simulated: true }));
  assert.deepEqual(competitionClusters(unverified), []);
  assert.deepEqual(competitionClusters(simulated), []);
});

test("only the top of a shortlist competes", () => {
  // "far" is always last and never within COMPETE_TOP_N of the leaders.
  const events = Array.from({ length: 10 }, () => search("a", "b", "c", "d", "far"));
  const clusters = competitionClusters(events);
  assert.ok(clusters.every((c) => !c.includes("far")),
    `being ${COMPETE_TOP_N + 2}th is not nearly being chosen`);
});

test("unrelated tools form separate clusters", () => {
  const events = [
    ...Array.from({ length: 5 }, () => search("weather", "forecast")),
    ...Array.from({ length: 5 }, () => search("isbn", "books")),
  ];
  const clusters = competitionClusters(events).map((c) => c.join(","));
  assert.equal(clusters.length, 2);
  assert.ok(clusters.includes("forecast,weather"));
  assert.ok(clusters.includes("books,isbn"));
});

// ---------------------------------------------------------------- standing
test("a tool with no known rivals sits at par", () => {
  // Not knowing who competes is not evidence that somebody is losing.
  assert.equal(standingOf("lonely", null, new Map()).standing, 1);
  assert.equal(standingOf("lonely", ["lonely"], new Map()).standing, 1);
});

// THE SEASONALITY CASE. The whole reason this is relative rather than absolute.
test("a cluster that goes quiet together puts nobody behind", () => {
  const st = standingOf("tax-april", ["tax-april", "tax-filing", "tax-estimate"], new Map());
  assert.equal(st.standing, 1);
  assert.match(st.reason, /quiet/);
});

// THE QUIET NICHE. Three calls a month is a real niche, not a dead one.
test("the leader of a tiny cluster is at par, not dying", () => {
  const mass = new Map([["best", 2], ["other", 1]]);
  assert.equal(standingOf("best", ["best", "other"], mass).standing, 1);
});

test("a tool losing badly to its cluster is below par, but bounded", () => {
  const mass = new Map([["winner", 1000], ["loser", 1]]);
  const st = standingOf("loser", ["winner", "loser"], mass);
  assert.ok(st.standing < 1);
  assert.equal(st.standing, STANDING_FLOOR, "never worse than the floor");
  assert.ok(st.raw_standing < STANDING_FLOOR, "even though the raw figure is worse");
});

test("being far above par is not a reward", () => {
  const mass = new Map([["winner", 1000], ["loser", 1]]);
  assert.equal(standingOf("winner", ["winner", "loser"], mass).standing, 1,
    "standing is a question about falling behind, not a bonus");
});

// ---------------------------------------------------------------- the curve
test("a call today counts as a whole call", () => {
  assert.equal(Math.round(decayedMass([NOW], 90, NOW) * 1000) / 1000, 1);
});

test("a call one half-life old counts as half", () => {
  assert.equal(Math.round(decayedMass([daysAgo(90)], 90, NOW) * 100) / 100, 0.5);
});

// The one-call reset: otherwise anybody can revive their own dead tool with a
// single call, which is a resurrection button with no cost attached.
test("one fresh call adds one call, it does not reset the old ones", () => {
  const dead = Array.from({ length: 200 }, () => daysAgo(400));
  const before = decayedMass(dead, 90, NOW);
  const after = decayedMass([...dead, NOW], 90, NOW);

  // The first version of this test asserted the total stayed under 5 and
  // failed at 10.19 — the assertion was wrong, not the curve. 200 calls at 400
  // days on a 90-day half-life legitimately retain about 9.2 effective calls.
  // What actually matters is that the fresh call is worth exactly one call and
  // buys nothing for the 200 behind it.
  assert.ok(Math.abs((after - before) - 1) < 0.001,
    `a fresh call should add exactly one, added ${(after - before).toFixed(4)}`);
});

// Worth stating as a property rather than leaving in a comment: on the
// provisional 90-day half-life, high-volume history survives a long time. A
// tool with a thousand calls a year ago is still above the archival floor.
// Whether that is right is exactly what the half-life has to be derived
// against, and it is not derived yet.
test("the provisional half-life is generous to high-volume history", () => {
  const live = decayedMass(Array.from({ length: 1000 }, () => daysAgo(365)), BASE_HALF_LIFE_DAYS, NOW);
  assert.ok(live > 1, `a thousand calls a year old still score ${live.toFixed(1)}`);
});

test("a shorter half-life decays faster", () => {
  const calls = Array.from({ length: 100 }, () => daysAgo(60));
  assert.ok(decayedMass(calls, 9, NOW) < decayedMass(calls, 90, NOW));
});

// ---------------------------------------------------------------- the floor
test("a tool that was never used is new, not faded", () => {
  const st = archiveState(0, 0);
  assert.equal(st.archived, false);
  assert.match(st.reason, /new, not faded/);
});

test("a tool whose usage has decayed below one effective call is archived", () => {
  assert.equal(archiveState(500, 0.4).archived, true);
  assert.equal(archiveState(500, 1.2).archived, false);
});

// ---------------------------------------------------------------- together
test("a seasonal tool survives a long silence when its whole cluster is silent", () => {
  const d = decayOf({
    toolId: "tax-april",
    callTimes: Array.from({ length: 300 }, () => daysAgo(150)),
    cluster: ["tax-april", "tax-filing"],
    recentMass: new Map(),
    now: NOW,
  });
  assert.equal(d.standing, 1);
  assert.equal(d.half_life_days, BASE_HALF_LIFE_DAYS);
  assert.equal(d.archived, false, "quiet together is not losing");
});

test("a tool losing to a live rival fades much faster than one that is not", () => {
  const callTimes = Array.from({ length: 40 }, () => daysAgo(120));
  const losing = decayOf({
    toolId: "old", callTimes, cluster: ["old", "new"],
    recentMass: new Map([["old", 1], ["new", 500]]), now: NOW,
  });
  const alone = decayOf({ toolId: "old", callTimes, cluster: null, recentMass: new Map(), now: NOW });

  assert.ok(losing.live_mass < alone.live_mass,
    `losing ${losing.live_mass} should be below unrivalled ${alone.live_mass}`);
  assert.equal(losing.archived, true, "something else is doing this job better");
  assert.equal(alone.archived, false, "nothing else does this job at all");
});

test("decay never runs on negative age", () => {
  // Clock skew between the writer and the nightly job must not inflate a score.
  const future = decayedMass([NOW + 10 * DAY], 90, NOW);
  assert.ok(future <= 1.0001, `a future call must not count more than one, got ${future}`);
});

// THE FEEDBACK LOOP, found by asking why the gap count had tripled: 33 of 36
// gaps were the builder's own duplicate checks. Every time it asked whether a
// need was already met, the asking was recorded as somebody needing it — so
// investigating a need made that need look more worth building. A justification
// manufacturing itself, which is the exact shape this project exists to stop.
test("a builder probing the registry builds no competition edges", () => {
  const events = Array.from({ length: 20 }, (_, i) =>
    ({ ranked: ["a", "b"], caller_id: `c${i}`, actor_verified: true, role: "builder" }));
  assert.deepEqual(competitionClusters(events), [],
    "the builder is not a user choosing between tools");
});

test("ordinary callers still build edges alongside builder traffic", () => {
  const events = [
    ...Array.from({ length: 10 }, (_, i) =>
      ({ ranked: ["a", "b"], caller_id: `bot${i}`, actor_verified: true, role: "builder" })),
    ...Array.from({ length: MIN_CO_RETRIEVAL_CALLERS }, (_, i) =>
      ({ ranked: ["a", "b"], caller_id: `person${i}`, actor_verified: true, role: "caller" })),
  ];
  assert.deepEqual(competitionClusters(events), [["a", "b"]]);
});
