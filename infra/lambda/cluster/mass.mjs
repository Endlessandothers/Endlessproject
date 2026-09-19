// Mass — Phase 1, issue #10.
//
// Pure: no AWS imports, so every scoring rule is testable without credentials.
//
// Mass is how much a tool is actually used. In Phase 1 it is the ONLY component
// of a tool's score: no brightness, no dependency weight, no decay. Those are
// Phase 2, and each needs data that does not exist yet. Shipping one honest
// number beats shipping four where three are guesses.
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
export const isCountable = (e) =>
  e.type === "call" && e.self_call !== true && e.actor_verified === true;

// Only SUCCESSFUL calls add mass, but failures are counted and reported.
//
// A tool that is called constantly and fails constantly is not useful, and
// scoring it on attempts would rank it above one that works. The failures are
// not thrown away: reliability is shown beside mass, so a tool with mass 40 and
// 50% failures is visibly different from one with mass 40 and none.
export function massOf(events) {
  const countable = events.filter(isCountable);
  const ok = countable.filter((e) => e.outcome === "success");

  // Distinct callers, for the same reason the gaps board counts them: a single
  // caller in a loop is not the same evidence as forty agents choosing a tool.
  // Reported alongside raw calls rather than replacing them, because for usage
  // both readings are legitimate and Phase 2 will need to choose between them
  // against real data.
  const callers = new Set(ok.map((e) => e.caller_id).filter(Boolean));
  const owners = new Set(ok.map((e) => e.owner).filter(Boolean));

  const durations = ok.map((e) => Number(e.ms)).filter(Number.isFinite).sort((a, b) => a - b);

  return {
    mass: ok.length,
    distinct_callers: callers.size,
    distinct_owners: owners.size,
    attempts: countable.length,
    failures: countable.length - ok.length,
    success_rate: countable.length ? Number((ok.length / countable.length).toFixed(4)) : null,
    p50_ms: durations.length ? durations[Math.floor(durations.length * 0.5)] : null,
    p95_ms: durations.length ? durations[Math.floor(durations.length * 0.95)] : null,
    self_calls_excluded: events.filter((e) => e.type === "call" && e.self_call === true).length,
    unverified_excluded: events.filter((e) => e.type === "call" && e.actor_verified !== true).length,
    first_call: ok.length ? ok.map((e) => e.ts).sort()[0] : null,
    last_call: ok.length ? ok.map((e) => e.ts).sort().at(-1) : null,
  };
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
export function scoreTools(toolIds, events) {
  const byTool = new Map(toolIds.map((id) => [id, []]));
  for (const e of events) {
    if (e.type !== "call" || !byTool.has(e.tool_id)) continue;
    byTool.get(e.tool_id).push(e);
  }

  return [...byTool.entries()]
    .map(([tool_id, es]) => ({ tool_id, ...massOf(es) }))
    .sort((a, b) =>
      b.mass - a.mass ||
      b.distinct_callers - a.distinct_callers ||
      a.tool_id.localeCompare(b.tool_id));
}

// Invariant #3: money never touches ranking.
//
// Asserted here rather than only in prose. If a scoring input ever arrives that
// came from a payment, this is where it gets caught — the check is cheap and the
// invariant is the reason an agent can trust the ranking at all.
const FORBIDDEN_INPUTS = ["credits", "paid", "sponsored", "expedited", "tier", "price"];

export function assertNoPaidInputs(row) {
  const found = Object.keys(row).filter((k) =>
    FORBIDDEN_INPUTS.some((f) => k.toLowerCase().includes(f)));
  if (found.length) {
    throw new Error(`ranking input derived from payment: ${found.join(", ")}`);
  }
  return row;
}
