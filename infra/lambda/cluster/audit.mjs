// Anti-gaming checks — Phase 2, issue #6.
//
// Pure: no AWS imports, so every check is testable without credentials.
//
// THIS SURFACES, IT DOES NOT BLOCK.
//
// Every pattern below has an innocent explanation and a guilty one, and no
// amount of arithmetic tells them apart. A new creator whose only users are
// friends looks exactly like a creator with a pile of sock puppets. Blocking on
// that would punish the first honest person through the door, and the first
// honest person is the one this project does not have yet.
//
// So these produce flags a human reads before money moves. The hard rules —
// self-calls, self-dependencies, distinct callers, verified identity — are
// enforced elsewhere and are not negotiable. What is here is the residue: the
// shapes those rules cannot decide, made visible instead of ignored.
//
// WHAT IS ALREADY ENFORCED, so this file does not pretend to be the defence:
//
//   auth.mjs        a call by a tool's own owner is not demand
//   mass.mjs        an owner earns no standing by depending on their own tool
//   decay.mjs       competition edges need distinct verified callers
//   cluster.mjs     a gap counts distinct callers, and the closer's own
//                   demand is removed before a bounty is assessed
//   isCountable     unverified and simulated traffic scores nothing
//
// AND THE HOLE NONE OF IT CLOSES. All of the above rests on one party being
// unable to cheaply become several. Minting a caller still costs nothing, so a
// determined owner with ten identities defeats every distinct-caller rule at
// once. These checks are what makes that visible while it is undecided; they
// are not a substitute for deciding it.

// A tool whose usage comes from very few callers has not been adopted, it has
// been used. That is fine for a new tool and suspicious for one claiming
// standing, so the flag carries the count rather than a verdict.
export const NARROW_ADOPTION_CALLERS = 3;

// How concentrated one caller's traffic has to be on one owner's tools before
// it reads more like staff than like a customer.
export const CONCENTRATION_RATIO = 0.9;
export const CONCENTRATION_MIN_CALLS = 20;

const pct = (n, d) => (d ? Number((n / d).toFixed(3)) : 0);

// Owner strings that differ only by punctuation, case or spacing.
//
// This is the defect from Phase 1 made searchable rather than fixed. air-quality
// carried "ericsonasamoah3" while its owner's caller carried "erics", and the
// self-call guard compared them, found them different, and let the call count.
// Those two do NOT normalise to each other and this check would not have caught
// them — which is exactly why it reports candidates for a person to look at
// instead of claiming to solve it.
const normalise = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function similarOwners(owners) {
  const byNorm = new Map();
  for (const o of owners) {
    if (!o) continue;
    const n = normalise(o);
    if (!n) continue;
    if (!byNorm.has(n)) byNorm.set(n, new Set());
    byNorm.get(n).add(o);
  }
  return [...byNorm.values()]
    .filter((set) => set.size > 1)
    .map((set) => [...set].sort());
}

// One caller sending almost all of its traffic to one owner's tools.
export function concentratedCallers(events, ownerOfTool) {
  const byCaller = new Map();
  for (const e of events) {
    if (e.type !== "call" || !e.caller_id) continue;
    if (!byCaller.has(e.caller_id)) byCaller.set(e.caller_id, { total: 0, owners: new Map() });
    const row = byCaller.get(e.caller_id);
    row.total += 1;
    const owner = ownerOfTool.get(e.tool_id) ?? null;
    if (owner) row.owners.set(owner, (row.owners.get(owner) ?? 0) + 1);
  }

  const out = [];
  for (const [caller_id, row] of byCaller) {
    if (row.total < CONCENTRATION_MIN_CALLS) continue;
    for (const [owner, n] of row.owners) {
      const ratio = pct(n, row.total);
      if (ratio >= CONCENTRATION_RATIO) {
        out.push({ caller_id, owner, calls: n, of: row.total, ratio });
      }
    }
  }
  return out.sort((a, b) => b.calls - a.calls);
}

// A tool whose mass rests on a handful of callers.
export function narrowAdoption(rows) {
  return rows
    .filter((r) => r.mass > 0 && r.distinct_callers < NARROW_ADOPTION_CALLERS)
    .map((r) => ({
      tool_id: r.tool_id, mass: r.mass, distinct_callers: r.distinct_callers,
      distinct_owners: r.distinct_owners,
    }))
    .sort((a, b) => b.mass - a.mass);
}

// A competition cluster where one owner holds most of the members.
//
// Owning a cluster is not an offence — somebody has to build the first three
// tools in a domain, and early on that will usually be the operator. It matters
// because standing is share of a cluster, so an owner holding most of a cluster
// is largely being compared against themselves.
export function ownedClusters(clusters, ownerOfTool) {
  const out = [];
  for (const members of clusters) {
    if (members.length < 2) continue;
    const counts = new Map();
    for (const id of members) {
      const o = ownerOfTool.get(id) ?? null;
      if (o) counts.set(o, (counts.get(o) ?? 0) + 1);
    }
    for (const [owner, n] of counts) {
      if (n / members.length > 0.5 && n > 1) {
        out.push({ owner, holds: n, of: members.length, members: [...members].sort() });
      }
    }
  }
  return out;
}

// Everything, in one pass, for a person to read.
export function audit({ rows = [], events = [], clusters = [], tools = [] }) {
  const ownerOfTool = new Map(tools.map((t) => [t.tool_id, t.owner ?? null]));
  const owners = [...new Set([
    ...tools.map((t) => t.owner),
    ...events.map((e) => e.owner),
  ])];

  const flags = {
    similar_owners: similarOwners(owners),
    concentrated_callers: concentratedCallers(events, ownerOfTool),
    narrow_adoption: narrowAdoption(rows),
    owned_clusters: ownedClusters(clusters, ownerOfTool),
    unverified_ownership: rows.filter((r) => r.ownership_verified === false).map((r) => r.tool_id),
  };

  return {
    generated_at: new Date().toISOString(),
    note: "Patterns worth a look, not verdicts. Every one of these has an innocent explanation; a new creator whose only users are friends looks exactly like a creator with sock puppets. The hard rules are enforced elsewhere. None of this closes the fact that minting a caller still costs nothing.",
    flag_count: Object.values(flags).reduce((n, v) => n + v.length, 0),
    thresholds: {
      narrow_adoption_callers: NARROW_ADOPTION_CALLERS,
      concentration_ratio: CONCENTRATION_RATIO,
      concentration_min_calls: CONCENTRATION_MIN_CALLS,
    },
    ...flags,
  };
}
