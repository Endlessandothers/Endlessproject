// Gap clustering and demand counting — Phase 1, issues #8 and #9.
//
// Pure: no AWS imports, so every counting rule below is testable without
// credentials. The rules are the product. See docs/phase-1-gap-clustering.md
// for why each one exists; this file is what enforces them.
//
// THE ONE SENTENCE. A cluster's demand is the number of DISTINCT VERIFIED
// CALLERS who asked for it, never the number of times it was asked.

// Two gaps are the same need when their query vectors are this close.
//
// DERIVED from the frozen blind set in sim/, 2026-09-20, by sweeping against
// labels written before the run. Not guessed, and not fitted to whatever the
// clustering happened to produce.
//
// The important finding is that the two populations OVERLAP: similarity within
// a need ran 0.171–0.834 (p05 0.191) and across needs -0.051–0.337 (p95 0.238).
// There is no value that separates them perfectly, so the question is not where
// the line is but which error to prefer.
//
// 0.35 makes ZERO wrong merges on the set while wrongly splitting 5 of 30
// same-need pairs. That is the safe direction: a split need is under-counted
// and may fall below the bar, whereas a merge invents one large need out of two
// smaller ones and would send a builder at the wrong problem. Under-reporting
// demand is recoverable; reporting demand that does not exist is the failure
// this whole subsystem was built to avoid.
export const DEFAULT_SIMILARITY = 0.35;

const dot = (a, b) => {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
};

const norm = (a) => Math.sqrt(dot(a, a));

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  const d = norm(a) * norm(b);
  return d === 0 ? 0 : dot(a, b) / d;
}

// Single-link agglomerative clustering, done the naive O(n^2) way.
//
// Deliberately naive. At Phase 1 volumes this is milliseconds, and a nightly
// batch has no latency budget worth optimising against. The moment it stops
// being fast enough is the moment there is enough gap data to choose a real
// algorithm against real distributions, rather than guessing now.
//
// Single-link rather than centroid: a gap joins a cluster if it is close to ANY
// member. Chaining is the known weakness, and it is the right trade here —
// "what is the weather in Oslo" and "will it rain in Bergen" should land
// together even if neither is close to the cluster's average.
export function cluster(gaps, similarity = DEFAULT_SIMILARITY) {
  const usable = gaps.filter((g) => Array.isArray(g.vector) && g.vector.length);
  const parent = usable.map((_, i) => i);

  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (i, j) => {
    const a = find(i), b = find(j);
    if (a !== b) parent[b] = a;
  };

  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      if (cosine(usable[i].vector, usable[j].vector) >= similarity) union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < usable.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(usable[i]);
  }
  return [...groups.values()];
}

// Everything that makes a cluster evidence rather than a count.
//
// occurrences is reported but is NOT the demand figure, and no decision is
// taken on it. It is here because intensity is worth reading, and because
// hiding it would make the distinct-caller number harder to sanity-check.
export function summarise(members, now = Date.now()) {
  const verified = members.filter((m) => m.actor_verified === true && m.caller_id);

  const callers = new Map();
  for (const m of verified) {
    const prev = callers.get(m.caller_id);
    if (!prev || m.ts < prev.first_seen) {
      callers.set(m.caller_id, {
        caller_id: m.caller_id,
        owner: m.owner ?? null,
        first_seen: m.ts,
        caller_created_at: m.caller_created_at ?? null,
      });
    }
  }
  const distinct = [...callers.values()];

  // By owner, not by caller id: one person holding ten keys is exactly the case
  // this is for. This is the number beneficiary exclusion operates on.
  const owners = new Set(distinct.map((c) => c.owner).filter(Boolean));

  const times = verified.map((m) => Date.parse(m.ts)).filter(Number.isFinite).sort((a, b) => a - b);
  const spreadDays = times.length > 1 ? (times.at(-1) - times[0]) / 86_400_000 : 0;

  // Caller age at the moment they asked, not today. A caller created after the
  // cluster started is the manufactured-demand shape; measuring age now would
  // let it launder itself simply by the passage of time.
  const ages = distinct
    .map((c) => (c.caller_created_at && c.first_seen
      ? (Date.parse(c.first_seen) - Date.parse(c.caller_created_at)) / 86_400_000
      : null))
    .filter((v) => v !== null && Number.isFinite(v));
  const medianAge = ages.length ? ages.sort((a, b) => a - b)[Math.floor(ages.length / 2)] : null;

  return {
    // The demand figure. One caller, one vote, however many times they asked.
    distinct_callers: distinct.length,
    distinct_owners: owners.size,
    occurrences: members.length,
    unverified_occurrences: members.length - verified.length,

    first_seen: verified.length ? new Date(Math.min(...times)).toISOString() : null,
    last_seen: verified.length ? new Date(Math.max(...times)).toISOString() : null,
    spread_days: Number(spreadDays.toFixed(2)),
    median_caller_age_days: medianAge === null ? null : Number(medianAge.toFixed(2)),

    callers: distinct.map((c) => ({ caller_id: c.caller_id, owner: c.owner })),
    // The query asked by the most callers reads better as a label than the
    // longest or the first, and needs no model to pick.
    label: pickLabel(members),
    queries: [...new Set(members.map((m) => m.query))].slice(0, 25),
  };
}

function pickLabel(members) {
  const counts = new Map();
  for (const m of members) counts.set(m.query, (counts.get(m.query) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] ?? "";
}

// Beneficiary exclusion — docs/phase-1-gap-clustering.md.
//
// The person who benefits from a gap looking urgent is the person who closes
// it. So the closer's own demand does not count toward the evidence that
// justified their bounty. Applied by OWNER, and it removes the payoff rather
// than trying to detect intent, because intent is not observable.
export function excludeBeneficiary(summary, beneficiaryOwner) {
  if (!beneficiaryOwner) return summary;
  const kept = summary.callers.filter((c) => c.owner !== beneficiaryOwner);
  return {
    ...summary,
    distinct_callers: kept.length,
    distinct_owners: new Set(kept.map((c) => c.owner).filter(Boolean)).size,
    callers: kept,
    excluded_owner: beneficiaryOwner,
    excluded_callers: summary.distinct_callers - kept.length,
  };
}

// Issue #9 — when a cluster is a repeated gap worth acting on.
//
// A threshold on distinct callers alone is exactly the mistake Phase 0 made
// with T: a single number fitted to one sample, which then failed on a held-out
// one. So the rule is a gate plus corroboration, and every component is
// reported so a reader can disagree with the verdict rather than having to
// trust it.
//
// MIN_CALLERS was swept against the blind set on 2026-09-20 and KEPT AT 3.
// At every bar from 1 to 5, the needs shown were exactly those labelled as
// having that many owners — no need was ever shown on less evidence than it
// had. So the sweep does not force a value, and 3 is retained because it is
// the more conservative reading of a set that is small and synthetic.
export const RULE = {
  min_callers: 3,
  min_spread_days: 1,
  // A cluster where every caller is younger than this, in days at the moment
  // they asked, is flagged rather than confirmed. Not rejected: a genuine burst
  // of new users is a real thing and looks identical from here.
  young_caller_days: 7,
};

export function assess(summary, rule = RULE) {
  const reasons = [];
  if (summary.distinct_callers < rule.min_callers) {
    reasons.push(`only ${summary.distinct_callers} distinct callers, ${rule.min_callers} needed`);
  }
  if (summary.distinct_owners < rule.min_callers) {
    reasons.push(`only ${summary.distinct_owners} distinct owners`);
  }
  if (summary.spread_days < rule.min_spread_days) {
    reasons.push(`asked over ${summary.spread_days} days, ${rule.min_spread_days} needed`);
  }

  const suspicions = [];
  if (summary.median_caller_age_days !== null && summary.median_caller_age_days < rule.young_caller_days) {
    suspicions.push(`callers were a median ${summary.median_caller_age_days} days old when they asked`);
  }
  if (summary.distinct_owners < summary.distinct_callers) {
    suspicions.push(`${summary.distinct_callers} callers but only ${summary.distinct_owners} owners`);
  }

  return {
    confirmed: reasons.length === 0,
    withheld_because: reasons,
    // Never blocks on its own. It is what a person looks at before a bounty.
    flags: suspicions,
  };
}
