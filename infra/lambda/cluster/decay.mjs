// Decay and the archival floor — Phase 2, issue #4.
//
// Pure: no AWS imports, so every rule here is testable without credentials.
//
// DECAY IS RELATIVE TO THE COMPETITION, NOT TO THE CALENDAR.
//
// The obvious design is a half-life on time since last use, and it is wrong in
// two ways that matter for a registry of small tools.
//
// It punishes seasonality. A tool used heavily every April and ignored for the
// other eleven months looks identical to one nobody has ever wanted.
//
// And it kills quiet niches outright. A cluster serving three calls a month is
// a perfectly good niche; under an absolute half-life every tool in it dies,
// including the only tool that does the job. Endless is a registry of SMALL
// tools, so most niches will look like that.
//
// What decay is actually for is the sentence in PROJECT.md: "a rushed fix fades
// and frees the slot for something better." The slot is within a job. So decay
// has to answer "is something else doing this job better?" — which is a
// comparison inside a cluster, not a reading of a clock.
//
// WHICH CLUSTER, THOUGH.
//
// Not the category: those are a filing convention. Not the description either —
// measured on 2026-09-20, description similarity recovers the hand-assigned
// categories at F1 0.565, because sunrise-sunset and postal-code-lookup are
// both "geo" and share nothing, while air-quality and weather-forecast are near
// neighbours filed apart.
//
// Tools compete when the same search returns both. That is behavioural, it is
// recorded rather than declared, and it cannot be moved by rewriting a
// description — which matters, because "write an unusual description so you
// land in a cluster of one and never decay" would otherwise be the obvious
// attack on this whole mechanism.
//
// WHEN THERE IS NO COMPETITION DATA, THERE IS NO RELATIVE DECAY. A tool with no
// known rivals sits at par and only fades on the absolute floor below. That is
// the honest default: not knowing who competes is not evidence that somebody is
// losing.

// Only the top of a shortlist counts as competing. Being eighth in a ranking is
// not a claim that a tool was nearly chosen.
//
// The whole graph is built from VERIFIED, non-simulated searches only, and a
// caller counts once per pair however many times they search.
export const COMPETE_TOP_N = 3;

// How many DISTINCT CALLERS must have seen two tools together before the edge
// is believed.
//
// Distinct callers, not occurrences, for the reason every other count in this
// system uses distinct callers: otherwise one party decides the graph.
//
// Found by building the graph and then noticing I had built it. Nine searches
// from a single caller produced a competition cluster, and that is an attack,
// not a quirk: craft queries that return your rival alongside a tool that
// dominates its cluster, repeat, and the rival's share collapses to near zero
// while its half-life drops tenfold. Search traffic is free and unlimited, so
// the cost of doing it is nothing.
//
// Requiring separate callers does not make it impossible. It makes it cost the
// same thing manufacturing gap demand costs — several identities that each had
// to be worth creating — which is the price this system asks everywhere else.
export const MIN_CO_RETRIEVAL_CALLERS = 3;

// PROVISIONAL, and the one genuinely fitted number in this file. It sets how
// long a tool losing badly to its cluster takes to halve. Nothing in the system
// has the traffic to derive it yet, and it is named here rather than buried so
// that it is obvious what has not been measured.
export const BASE_HALF_LIFE_DAYS = 90;

// A bound, not a fit: however badly a tool is losing, it may not decay more
// than ten times faster than par. Without it, a share near zero produces a
// half-life near zero and a tool vanishes between two nightly runs.
export const STANDING_FLOOR = 0.1;

// The window over which standing is judged. Long enough that a quiet fortnight
// is not a verdict.
export const STANDING_WINDOW_DAYS = 30;

const DAY = 86_400_000;

// Pair keys join two tool ids. A separator that cannot occur in an id, written
// as an escape rather than embedded raw: a NUL byte sitting invisibly in source
// is the kind of thing that survives until something strips it.
const SEP = "\u0000";

// Which tools compete, read off the search log.
//
// An undirected graph: an edge when at least MIN_CO_RETRIEVAL_CALLERS separate
// callers saw the two tools in the same shortlist. Connected components are the
// clusters.
//
// Single-link again, and for the same reason as the gap clustering: A competes
// with B and B with C is enough to treat all three as one job, because the
// alternative is deciding that A and C are rivals only if they meet directly,
// which no amount of traffic ever settles.
export function competitionClusters(searchEvents, {
  topN = COMPETE_TOP_N, minCallers = MIN_CO_RETRIEVAL_CALLERS,
} = {}) {
  // pair -> set of callers who saw that pair together.
  const pairs = new Map();
  for (const e of searchEvents) {
    // An unverified search cannot contribute to the graph, for the same reason
    // it cannot contribute to a gap count: there is nobody behind it.
    const caller = e.caller_id;
    if (!caller || e.actor_verified !== true || e.simulated === true) continue;
    // A builder probing the registry is not a user choosing between tools, so
    // its searches build no competition edges either. Same reason its searches
    // log no gaps.
    if (e.role === "builder") continue;

    const ranked = (e.ranked ?? []).slice(0, topN);
    for (let i = 0; i < ranked.length; i++) {
      for (let j = i + 1; j < ranked.length; j++) {
        const key = [ranked[i], ranked[j]].sort().join(SEP);
        if (!pairs.has(key)) pairs.set(key, new Set());
        pairs.get(key).add(caller);
      }
    }
  }

  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };

  for (const [key, callers] of pairs) {
    if (callers.size < minCallers) continue;
    const [a, b] = key.split(SEP);
    union(a, b);
  }

  const groups = new Map();
  for (const x of parent.keys()) {
    const root = find(x);
    if (!groups.has(root)) groups.set(root, new Set());
    groups.get(root).add(x);
  }
  return [...groups.values()].map((set) => [...set].sort());
}

// Where a tool stands against the tools it competes with.
//
// 1.0 is par — exactly the share an equal member of the cluster would have.
// Above par does not accelerate anything; there is no reward here, only a
// question about who is falling behind.
//
// A cluster with no recent usage at all returns par for everyone: the whole job
// went quiet together, so nobody is losing to anybody. That is the seasonality
// case, and it is the reason this is relative in the first place.
export function standingOf(toolId, clusterMembers, recentMass) {
  if (!clusterMembers || clusterMembers.length < 2) {
    return { standing: 1, cluster_size: clusterMembers?.length ?? 1, reason: "no known rivals" };
  }
  const total = clusterMembers.reduce((n, id) => n + (recentMass.get(id) ?? 0), 0);
  if (total === 0) {
    return { standing: 1, cluster_size: clusterMembers.length, reason: "whole cluster quiet" };
  }
  const share = (recentMass.get(toolId) ?? 0) / total;
  const par = 1 / clusterMembers.length;
  const raw = share / par;
  return {
    standing: Number(Math.min(1, Math.max(STANDING_FLOOR, raw)).toFixed(4)),
    raw_standing: Number(raw.toFixed(4)),
    cluster_size: clusterMembers.length,
    share: Number(share.toFixed(4)),
    reason: raw >= 1 ? "at or above par" : "below par",
  };
}

// The decayed score.
//
// Every call is aged individually rather than the whole score being aged by the
// time since the most recent one. Otherwise a single call today restores a
// tool that has been dead for a year, which is a one-call reset anybody can
// perform on their own tool.
export function decayedMass(callTimes, halfLifeDays, now) {
  if (!halfLifeDays) return 0;
  let sum = 0;
  for (const t of callTimes) {
    const ageDays = Math.max(0, (now - t) / DAY);
    sum += Math.pow(0.5, ageDays / halfLifeDays);
  }
  return sum;
}

// Archived, never deleted: it stops appearing in discovery, and its rows and
// version history stay, because anything that ever depended on it still has to
// resolve. Reversible — usage returning raises the decayed mass back over the
// floor on the next run.
//
// THE FLOOR IS ONE EFFECTIVE CALL, which is a natural unit rather than a chosen
// one. Below it, a tool's entire accumulated usage has decayed to less than a
// single present-day call.
//
// A tool that never had any mass is NOT archived. It is new, not faded, and the
// two are only indistinguishable if you look at the score alone.
export function archiveState(rawMass, live) {
  if (rawMass <= 0) return { archived: false, reason: "never used — new, not faded" };
  if (live < 1) return { archived: true, reason: `decayed to ${live.toFixed(3)} effective calls` };
  return { archived: false, reason: null };
}

// One tool's decay, given its call times and its cluster.
export function decayOf({ toolId, callTimes = [], cluster = null, recentMass = new Map(), now = Date.now() }) {
  const st = standingOf(toolId, cluster, recentMass);
  const halfLife = BASE_HALF_LIFE_DAYS * st.standing;
  const raw = callTimes.length;
  const live = decayedMass(callTimes, halfLife, now);
  const state = archiveState(raw, live);

  return {
    live_mass: Number(live.toFixed(3)),
    half_life_days: Number(halfLife.toFixed(1)),
    standing: st.standing,
    standing_reason: st.reason,
    cluster_size: st.cluster_size,
    cluster_share: st.share ?? null,
    ...state,
  };
}
