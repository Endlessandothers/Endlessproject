// The 3D world's view — Phase 2, issue #5. Stasis.
//
// Pure: no AWS imports, so the separation below is testable without credentials.
//
// TWO AUDIENCES, TWO FILES, AND THAT IS THE WHOLE DESIGN.
//
//   tools.json   what AGENTS consume. Mass, brightness, dependency weight,
//                decay, archived. No paid field has ever been in it and
//                assertNoPaidInputs fails the nightly run if one arrives.
//
//   world.json   what the 3D WORLD renders, for people to look at. Visual
//                stage, and whether a creator is paying to hold it.
//
// Stasis is advertising. A creator who publishes a tool or an app and wants
// people to seek it out specifically can pay to keep their star shining in the
// world after usage drops. It buys visibility to HUMANS looking at the world.
//
// It buys nothing in the phantom layer. It does not change what search returns,
// what an agent is offered, what ranks above what, or whether an archived tool
// is discoverable. An archived tool with stasis is still archived: it keeps a
// star in the sky and stays out of every result an agent ever sees.
//
// WHY A SEPARATE FILE RATHER THAN A FIELD.
//
// A field would work and would rely on everyone downstream remembering not to
// read it. Two files mean the agent-facing artefact does not CONTAIN the paid
// state, so consuming it by accident is not possible rather than merely
// discouraged. The invariant stops depending on discipline.
//
// AND THE WORLD SAYS SO. A star held up by money is labelled as held up by
// money, in the same object that says it is shining. PROJECT.md's monetization
// table promises "labeled placement, separate from organic results", and an
// unlabelled sponsored star would break that promise in the one place a person
// is actually looking.

// When a tool's live mass makes it a star rather than a planet.
//
// PROVISIONAL. PROJECT.md says a tool "ignites once it crosses a sustained-usage
// threshold" and does not say where, because nobody knows yet. Twenty effective
// calls is a placeholder chosen to be small enough that the first real tool can
// reach it and large enough that one afternoon of traffic does not.
export const STAR_THRESHOLD = 20;

export const STAGES = ["dark", "planet", "star"];

// The stage a tool has actually earned, from the agent-facing numbers only.
// Nothing paid reaches this function; it does not take a stasis argument.
export function earnedStage({ live_mass = 0, archived = false }) {
  if (archived) return "dark";
  return live_mass >= STAR_THRESHOLD ? "star" : "planet";
}

const rank = (stage) => STAGES.indexOf(stage);

// What the world draws.
//
// Stasis freezes the stage recorded when it was bought — it cannot promote a
// tool that never reached that stage, because a creator buys the right to KEEP
// a star, not to be given one. A tool currently doing better than its frozen
// stage renders at the better one: stasis is a floor, never a ceiling.
export function worldStage(tool, stasis = null) {
  const earned = earnedStage(tool);
  if (!stasis?.active) {
    return { stage: earned, earned_stage: earned, sponsored: false, held_by: null };
  }

  const frozen = STAGES.includes(stasis.frozen_stage) ? stasis.frozen_stage : earned;
  const shown = rank(frozen) > rank(earned) ? frozen : earned;

  return {
    stage: shown,
    earned_stage: earned,
    // Labelled only when the money is actually doing something. A creator
    // paying for stasis on a tool that is thriving anyway is not being given
    // placement, and marking it sponsored would be as misleading as hiding it.
    sponsored: shown !== earned,
    held_by: shown !== earned ? stasis.owner ?? null : null,
    frozen_stage: frozen,
    since: stasis.since ?? null,
  };
}

// The whole world view, built from the agent-facing rows plus the paid state.
//
// The two arrive as separate arguments and leave in a separate file. Anything
// wanting to blend them has to do it deliberately, in the open.
export function buildWorld(rows, stasisByTool = {}, now = new Date()) {
  const bodies = rows.map((r) => {
    const st = worldStage(r, stasisByTool[r.tool_id]);
    return {
      tool_id: r.tool_id,
      name: r.name ?? null,
      // Visual size and light. Derived from the earned numbers, because what a
      // body LOOKS like is a rendering of what it did.
      ...st,
      live_mass: r.live_mass ?? 0,
      brightness: r.brightness ?? null,
      dependents: r.dependents ?? 0,
      archived: r.archived === true,
    };
  });

  return {
    generated_at: now.toISOString(),
    note: "What the 3D world renders. Stasis is advertising: it holds a star visible to people after usage drops, and changes nothing an agent sees. An archived tool with stasis is still archived and still absent from every search result. Sponsored bodies are labelled.",
    star_threshold: STAR_THRESHOLD,
    bodies_total: bodies.length,
    stars: bodies.filter((b) => b.stage === "star").length,
    sponsored: bodies.filter((b) => b.sponsored).length,
    bodies,
  };
}
