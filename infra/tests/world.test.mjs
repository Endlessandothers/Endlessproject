// Stasis — Phase 2, issue #5.
//
// The standing commitment says every new paid product gets a test proving it
// does not reach agent-facing ranking. Stasis is the first product that makes
// that commitment cost something, because it is genuinely adjacent: it buys
// visibility in the world, and the claim that world visibility is not ranking
// has to hold up under a test rather than in a sentence.

import { test } from "node:test";
import assert from "node:assert/strict";
import { earnedStage, worldStage, buildWorld, STAR_THRESHOLD } from "../lambda/cluster/world.mjs";
import { scoreTools, assertNoPaidInputs } from "../lambda/cluster/mass.mjs";

const held = (over = {}) => ({ active: true, frozen_stage: "star", owner: "acme", since: "2026-09-01", ...over });

// ---------------------------------------------------------------- the earned stage
test("a stage is earned from usage alone", () => {
  assert.equal(earnedStage({ live_mass: 0 }), "planet");
  assert.equal(earnedStage({ live_mass: STAR_THRESHOLD }), "star");
  assert.equal(earnedStage({ live_mass: 1000, archived: true }), "dark");
});

// The function that decides what a tool earned takes no stasis argument at all,
// so money cannot reach it even by mistake.
test("the earned stage cannot be influenced by payment", () => {
  assert.equal(earnedStage.length, 1);
  const faded = { live_mass: 1, archived: false };
  assert.equal(earnedStage(faded), "planet");
  assert.equal(earnedStage({ ...faded, stasis: true, sponsored: true, paid: 999 }), "planet");
});

// ---------------------------------------------------------------- what stasis buys
test("stasis keeps a star visible after usage falls away", () => {
  const w = worldStage({ live_mass: 2 }, held());
  assert.equal(w.stage, "star", "the world still shows a star");
  assert.equal(w.earned_stage, "planet", "and still records what was earned");
  assert.equal(w.sponsored, true);
  assert.equal(w.held_by, "acme");
});

// A creator buys the right to KEEP a star, not to be handed one.
test("stasis cannot promote a tool to a stage it never reached", () => {
  const w = worldStage({ live_mass: 1 }, held({ frozen_stage: "planet" }));
  assert.equal(w.stage, "planet");
  assert.equal(w.sponsored, false, "nothing was held up, so nothing is sponsored");
});

test("stasis is a floor, never a ceiling", () => {
  // A tool doing better than its frozen stage renders at the better one.
  const w = worldStage({ live_mass: STAR_THRESHOLD * 10 }, held({ frozen_stage: "planet" }));
  assert.equal(w.stage, "star");
  assert.equal(w.sponsored, false);
});

test("paying for a tool that is thriving anyway is not sponsored placement", () => {
  // Marking this sponsored would be as misleading as hiding a real one.
  const w = worldStage({ live_mass: STAR_THRESHOLD * 2 }, held());
  assert.equal(w.stage, "star");
  assert.equal(w.sponsored, false);
  assert.equal(w.held_by, null);
});

test("a sponsored body is always labelled, in the same object that shines it", () => {
  const world = buildWorld(
    [{ tool_id: "faded", live_mass: 1 }, { tool_id: "real", live_mass: STAR_THRESHOLD * 3 }],
    { faded: held() },
  );
  const faded = world.bodies.find((b) => b.tool_id === "faded");
  assert.equal(faded.stage, "star");
  assert.equal(faded.sponsored, true);
  assert.equal(world.sponsored, 1);
  assert.equal(world.bodies.find((b) => b.tool_id === "real").sponsored, false);
});

// ---------------------------------------------------------------- what it does not buy
//
// The point the whole design turns on.
test("an archived tool with stasis is still archived", () => {
  const w = worldStage({ live_mass: 0.2, archived: true }, held());
  assert.equal(w.stage, "star", "it keeps a star in the sky");
  assert.equal(w.earned_stage, "dark");

  // And the agent-facing row is untouched: archived is archived.
  const world = buildWorld([{ tool_id: "gone", live_mass: 0.2, archived: true }], { gone: held() });
  assert.equal(world.bodies[0].archived, true,
    "stasis holds a light in the world and does not return a tool to discovery");
});

test("no paid field survives into a scored row", () => {
  const events = [{
    type: "call", tool_id: "t", outcome: "success", caller_id: "c", owner: "o",
    actor_verified: true, self_call: false, ms: 10, ts: "2026-09-01T00:00:00Z",
  }];
  for (const row of scoreTools([{ tool_id: "t", owner: "o" }], events)) {
    assert.doesNotThrow(() => assertNoPaidInputs(row));
    for (const key of ["stasis", "sponsored", "frozen_stage", "held_by"]) {
      assert.ok(!(key in row), `${key} must not appear in an agent-facing row`);
    }
  }
});

test("stasis is refused as a ranking input if it ever reaches the scorer", () => {
  for (const bad of [{ mass: 5, stasis: true }, { mass: 5, sponsored: true }, { mass: 5, stasis_since: "x" }]) {
    assert.throws(() => assertNoPaidInputs(bad), /derived from payment/);
  }
});

test("the world view carries no ranking and the ranking carries no world", () => {
  const rows = [{ tool_id: "t", live_mass: 5, brightness: 0.9, name: "T" }];
  const world = buildWorld(rows, { t: held() });
  // The world knows about payment. It does not know about order.
  assert.ok("sponsored" in world.bodies[0]);
  assert.ok(!("rank" in world.bodies[0]) && !("position" in world.bodies[0]));
  // And nothing the world added leaked back into the row it was built from.
  assert.ok(!("sponsored" in rows[0]) && !("stage" in rows[0]));
});

test("a tool with no stasis record renders exactly as it earned", () => {
  for (const stasis of [null, undefined, {}, { active: false, frozen_stage: "star" }]) {
    assert.equal(worldStage({ live_mass: 1 }, stasis).stage, "planet");
  }
});
