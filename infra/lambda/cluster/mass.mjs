// Mass — Phase 1, issue #10.
//
// Pure: no AWS imports, so every scoring rule is testable without credentials.
//
// Three numbers, kept apart:
//
//   MASS               direct calls — somebody chose this tool
//   BRIGHTNESS         how reliably it works, on its own scale
//   DEPENDENCY WEIGHT  what other tools were built on it
//
// None is blended into the others. A blend needs weights, the weights come from
// watching real traffic, and there is no real traffic yet — so this publishes
// components and lets whatever consumes them decide, rather than baking a
// guessed trade-off into a single number nobody can take apart afterwards.
//
// Decay is the fourth and is not here yet.
//
// RECOMPUTED FROM THE EVENT LOG, NEVER ACCUMULATED.
//
// There is no running total anywhere. Mass is derived from the append-only log
// every time it is wanted, which means a scoring rule can be changed and the
// whole history rescored under it. A counter incremented at call time would
// freeze today's rule into data and make every future correction impossible —
// and would also be the thing to attack, because a number you can only add to
// is a number nobody can audit.

// A call by the tool's own owner is not demand. Flagged at write time by
// exec-fn (see auth.mjs isSelfCall), because ownership on either side can
// change and the log has to stay true to the moment.
//
// Simulated traffic is excluded for the same reason it is kept off the gaps
// board: it runs through every real code path on purpose, and its demand is
// still invented. tools.json is a public claim about what people use, and a
// number inflated by a test harness is the same lie as a manufactured gap —
// the quarantine has to cover both surfaces or it covers neither.
export const isCountable = (e) =>
  e.type === "call" && e.self_call !== true && e.actor_verified === true && e.simulated !== true;

// Only SUCCESSFUL calls add mass, but failures are counted and reported.
//
// A tool that is called constantly and fails constantly is not useful, and
// scoring it on attempts would rank it above one that works. The failures are
// not thrown away: reliability is shown beside mass, so a tool with mass 40 and
// 50% failures is visibly different from one with mass 40 and none.
export function massOf(events) {
  const countable = events.filter(isCountable);
  const ok = countable.filter((e) => e.outcome === "success");

  // Direct calls only. Phase 2, issue #3.
  //
  // A call arriving VIA another tool is not somebody choosing this tool; it is
  // the consequence of somebody choosing a DIFFERENT one. Counting it as demand
  // would let a single popular dependent manufacture unlimited apparent
  // popularity for everything beneath it, which is a dependency graph turning
  // into a popularity illusion. It is counted instead as dependency weight,
  // separately, below.
  const direct = ok.filter((e) => !e.via_tool);
  const viaTool = ok.filter((e) => e.via_tool);

  // Distinct callers, for the same reason the gaps board counts them: a single
  // caller in a loop is not the same evidence as forty agents choosing a tool.
  // Reported alongside raw calls rather than replacing them, because for usage
  // both readings are legitimate and Phase 2 will need to choose between them
  // against real data.
  const callers = new Set(direct.map((e) => e.caller_id).filter(Boolean));
  const owners = new Set(direct.map((e) => e.owner).filter(Boolean));

  // Latency over every successful execution, direct or not. How fast a tool
  // runs does not depend on who asked for it.
  const durations = ok.map((e) => Number(e.ms)).filter(Number.isFinite).sort((a, b) => a - b);

  return {
    mass: direct.length,
    calls_via_tools: viaTool.length,
    distinct_callers: callers.size,
    distinct_owners: owners.size,
    attempts: countable.length,
    failures: countable.length - ok.length,
    success_rate: countable.length ? Number((ok.length / countable.length).toFixed(4)) : null,
    p50_ms: durations.length ? durations[Math.floor(durations.length * 0.5)] : null,
    p95_ms: durations.length ? durations[Math.floor(durations.length * 0.95)] : null,
    self_calls_excluded: events.filter((e) => e.type === "call" && e.self_call === true).length,
    unverified_excluded: events.filter((e) => e.type === "call" && e.actor_verified !== true).length,
    simulated_excluded: events.filter((e) => e.type === "call" && e.simulated === true).length,
    first_call: ok.length ? ok.map((e) => e.ts).sort()[0] : null,
    last_call: ok.length ? ok.map((e) => e.ts).sort().at(-1) : null,
    ...brightnessOf(countable),
  };
}

// ---------------------------------------------------------------- brightness
//
// Phase 2, issue #2. Quality, tracked SEPARATELY from mass and never folded
// into it: a tool can be large and dim, or small and bright, and collapsing
// that into one number destroys the only signal that says which.
//
// WHY THE WILSON LOWER BOUND RATHER THAN THE SUCCESS RATE.
//
// A raw ratio says a tool that succeeded once out of once is perfect, and that
// a tool with 99 successes in 100 is worse than it. Both readings are wrong in
// the direction that matters, because a brand new tool would outrank a proven
// one on its first call.
//
// The Wilson score interval's lower bound answers the question actually being
// asked: given what has been observed, what is the worst the true success rate
// plausibly is? One success out of one lands near 0.21; ninety-nine out of a
// hundred lands near 0.95. Evidence has to accumulate before brightness does.
//
// It is also NOT a free parameter. z is the confidence level, the only choice
// in it, and 1.96 is the ordinary 95% — so unlike the rest of Phase 2 this is
// not a curve someone fitted, it is a standard estimator with a standard
// constant. That is the whole reason to prefer it here.
const Z = 1.96;

export function wilsonLowerBound(successes, trials, z = Z) {
  if (!trials) return 0;
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const centre = p + z2 / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials);
  return Math.max(0, (centre - margin) / denom);
}

// LATENCY IS REPORTED, NOT SCORED.
//
// Turning milliseconds into a quality number needs a budget — what counts as
// slow — and there is no non-arbitrary answer. A geocoder and a document parser
// have nothing in common on that axis, and picking one number for both would be
// exactly the kind of guessed curve this phase is trying not to accumulate.
//
// So p50 and p95 sit beside brightness rather than inside it. When there is
// enough traffic to see what "slow" means per category, that becomes a derived
// number rather than a chosen one.
export function brightnessOf(countable) {
  const ok = countable.filter((e) => e.outcome === "success");
  return {
    brightness: countable.length ? Number(wilsonLowerBound(ok.length, countable.length).toFixed(4)) : null,
    brightness_basis: "wilson-lower-bound-95",
    // No satisfaction signal exists. PROJECT.md lists it as a brightness
    // component; nothing in the system has ever asked a caller whether the
    // answer was any good, so it is named as absent rather than quietly
    // dropped from the definition.
    satisfaction: null,
  };
}

// ---------------------------------------------------------------- dependency weight
//
// Phase 2, issue #3. Being built on is real standing — but it is not demand,
// so it is computed apart from mass and published apart from it.
//
// WEIGHT FLOWS FROM A DEPENDENT'S OWN DIRECT MASS, which is what makes this
// hard to fabricate. Publishing ten tools that depend on yours moves nothing:
// each contributes its own direct mass, and an unused tool has none. Standing
// can only arrive through something other people actually chose.
//
// ONE LEVEL, NOT A PROPAGATING CHAIN. PROJECT.md requires depth of propagation
// to be capped; one level is the most conservative cap and the only one that
// needs no second damping constant. Multi-level propagation is a PageRank-shaped
// problem, and choosing its parameters without traffic to fit them against is
// exactly the accumulation of guessed curves this phase is trying to avoid.
//
// DAMPING IS PROVISIONAL AND SAYS SO. 0.25 encodes "being depended on by a tool
// with 100 direct calls is worth about as much as 25 direct calls of your own",
// which is a judgement nobody has data for. It is the first parameter to derive
// against the simulation.
export const DEPENDENCY_DAMPING = 0.25;

export function dependencyWeights(tools, events, damping = DEPENDENCY_DAMPING) {
  const rows = tools.map((t) => (typeof t === "string" ? { tool_id: t, owner: null } : t));
  const ownerOf = new Map(rows.map((t) => [t.tool_id, t.owner ?? null]));

  // Direct mass per tool: what each tool earned by being chosen itself.
  const directMass = new Map();
  for (const e of events) {
    if (!isCountable(e) || e.outcome !== "success" || e.via_tool) continue;
    directMass.set(e.tool_id, (directMass.get(e.tool_id) ?? 0) + 1);
  }

  // The graph, read off the events rather than off the declarations. A tool
  // that DECLARES a dependency it never exercises has not been built upon, and
  // declarations are free to write.
  const dependents = new Map();
  for (const e of events) {
    if (!isCountable(e) || e.outcome !== "success" || !e.via_tool) continue;
    if (!dependents.has(e.tool_id)) dependents.set(e.tool_id, new Set());
    dependents.get(e.tool_id).add(e.via_tool);
  }

  const out = new Map();
  for (const t of rows) {
    const seen = [...(dependents.get(t.tool_id) ?? [])];
    // THE NEW ATTACK SURFACE, closed where it opens.
    //
    // The self-call rule stops an owner calling their own tool. It says nothing
    // about an owner DEPENDING on their own tool — which would let one tool's
    // real usage be counted twice for the same person, once as the dependent's
    // mass and again as the dependency's standing. Same principle, other edge.
    const kept = seen.filter((d) => !t.owner || ownerOf.get(d) !== t.owner);
    const weight = kept.reduce((n, d) => n + (directMass.get(d) ?? 0), 0) * damping;

    out.set(t.tool_id, {
      dependency_weight: Number(weight.toFixed(3)),
      dependents: kept.length,
      dependent_tools: kept.sort(),
      self_dependents_excluded: seen.length - kept.length,
      damping,
    });
  }
  return out;
}

// Self-call exclusion is only as good as the owner strings it compares.
//
// Found live on 2026-09-19: air-quality carried owner "ericsonasamoah3" while
// the caller that invoked it carried owner "erics". Same person, two strings,
// so isSelfCall compared them, found them different, and the wash-trading
// guard did not fire. Nothing errored — the mass was simply wrong.
//
// Ownership is now taken from the verified caller at publication and flagged
// owner_verified, so this cannot recur for anything published after that. It
// CANNOT be repaired for what came before: correcting a published version's
// owner would mean rewriting an immutable row, and guessing which free-text
// owners are the same person is exactly the kind of guess that produced this.
//
// So it is reported instead. A tool whose ownership was never verified has an
// unreliable self-call figure, and anything consuming mass has to know that
// rather than discover it the way this was discovered.
export const ownershipTrustworthy = (tool) => tool?.owner_verified === true;

// Score every tool from one pass over the log.
//
// Tools with no calls are INCLUDED at mass zero rather than omitted. A registry
// that only lists what has been used cannot show you what has not, and "nobody
// has ever called this" is a finding rather than an absence.
export function scoreTools(tools, events, damping = DEPENDENCY_DAMPING) {
  const rows = tools.map((t) => (typeof t === "string" ? { tool_id: t, owner: null } : t));
  const byTool = new Map(rows.map((t) => [t.tool_id, []]));
  for (const e of events) {
    if (e.type !== "call" || !byTool.has(e.tool_id)) continue;
    byTool.get(e.tool_id).push(e);
  }
  const weights = dependencyWeights(rows, events, damping);

  return [...byTool.entries()]
    .map(([tool_id, es]) => ({ tool_id, ...massOf(es), ...weights.get(tool_id) }))
    // Sorted on MASS, not on mass plus weight. Phase 2 computes the components
    // and refuses to blend them, because a blend needs weights and the weights
    // come from watching real traffic. Anything consuming this picks its own
    // ordering from fields it can see.
    .sort((a, b) =>
      b.mass - a.mass ||
      b.dependency_weight - a.dependency_weight ||
      b.distinct_callers - a.distinct_callers ||
      a.tool_id.localeCompare(b.tool_id));
}

// Invariant #3: money never touches ranking.
//
// Asserted here rather than only in prose. If a scoring input ever arrives that
// came from a payment, this is where it gets caught — the check is cheap and the
// invariant is the reason an agent can trust the ranking at all.
// Named substrings rather than exact keys, so a field has to actively avoid
// looking like money to slip through. "stasis" is here because it is the first
// paid product that touches how a tool is SEEN — it belongs in world.json and
// must never arrive in a scored row.
const FORBIDDEN_INPUTS = [
  "credits", "paid", "sponsored", "expedited", "tier", "price", "stasis",
];

export function assertNoPaidInputs(row) {
  const found = Object.keys(row).filter((k) =>
    FORBIDDEN_INPUTS.some((f) => k.toLowerCase().includes(f)));
  if (found.length) {
    throw new Error(`ranking input derived from payment: ${found.join(", ")}`);
  }
  return row;
}
