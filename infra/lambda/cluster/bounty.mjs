// Bounties — Phase 2, issue #7.
//
// Pure: no AWS imports, so the rules that decide whether money moves are
// testable without credentials.
//
// A bounty is a reward for closing a need nobody could meet. It is the first
// thing in Endless actually worth gaming, because it is the first thing with
// money attached — and every counting rule in this system was written for a
// world with no prize in it.
//
// THREE RULES, AND THEY ARE THE WHOLE DESIGN.
//
// 1. THE CLOSER'S OWN DEMAND DOES NOT COUNT TOWARD THEIR BOUNTY.
//
//    Whoever benefits from a need looking urgent is the person who closes it.
//    So before a bounty is assessed, every request that came from the claimant
//    is removed from the evidence, and the need has to still qualify without
//    them. This is the one rule that does not require detecting intent — it
//    removes the payoff instead, which matters because intent is not
//    observable and a determined actor is better at hiding it than anyone is
//    at spotting it.
//
// 2. CLOSURE IS JUDGED BY THE ADJUDICATOR, NOT BY A THRESHOLD.
//
//    docs/deferred-corrections.md filed this against Phase 3: PROJECT.md
//    defined closure as the originating queries resolving "above threshold",
//    and Phase 0 had already measured that a threshold fitted to one query set
//    gave 0% false gaps on it and 31.6% on a held-out one. A bounty paid on a
//    moving number can be earned on Monday and not on Wednesday with nothing
//    about the tool having changed.
//
//    So closure asks the adjudicator, per query, whether the new tool does the
//    job — the same mechanism that decided the gap in the first place. If the
//    two could disagree, the system could report a need and its closure at the
//    same moment.
//
// 3. IT REWARDS CLOSURE THAT HOLDS, NOT CLOSURE THAT ARRIVES.
//
//    PROJECT.md: "Bounties reward quality of closure (does it get reused and
//    trusted afterward), not speed of publishing — otherwise creators race to
//    close gaps badly." So a claim is assessed after the tool has been used by
//    people who are not the claimant, and it can be assessed as closed-but-poor.

import { assess, excludeBeneficiary } from "./cluster.mjs";

// What fraction of a cluster's queries the new tool must answer.
//
// Not all of them. A cluster is a group of things that MEAN the same, not that
// are the same, and a tool that answers four of five phrasings has closed the
// need for anyone who asked it the ordinary way. Requiring every query would
// make the strictest phrasing in the cluster the definition of the need.
//
// PROVISIONAL. Nothing has enough clusters to derive it from.
export const CLOSURE_FRACTION = 0.8;

// How much independent use a closing tool must have before the bounty pays.
//
// This is what makes rule 3 real. Zero would pay on publication, which is
// exactly the race PROJECT.md warns about.
export const MIN_INDEPENDENT_CALLERS = 3;

// Is this need still worth a bounty once the claimant is removed from it?
//
// Called before any money is discussed, because a need that only exists
// because of the person claiming it is not a need.
export function eligibility(summary, claimantOwner, rule) {
  const gross = assess(summary, rule);
  const net = excludeBeneficiary(summary, claimantOwner);
  const verdict = assess(net, rule);

  return {
    eligible: verdict.confirmed,
    gross_callers: summary.distinct_callers,
    net_callers: net.distinct_callers,
    excluded_callers: net.excluded_callers ?? 0,
    // Stated plainly because it is the interesting case: the need was real
    // enough to show on the board, and is not real enough to pay for.
    manufactured: gross.confirmed && !verdict.confirmed,
    withheld_because: verdict.withheld_because,
    flags: verdict.flags,
  };
}

// Did the tool actually close the need?
//
// verdicts is one entry per originating query: { query, tool_id } where tool_id
// is what the adjudicator chose, or null if it said nothing fits.
export function closure(verdicts, toolId, fraction = CLOSURE_FRACTION) {
  const total = verdicts.length;
  const answered = verdicts.filter((v) => v.tool_id === toolId);
  const stillOpen = verdicts.filter((v) => v.tool_id === null);
  const ratio = total ? answered.length / total : 0;

  return {
    closed: total > 0 && ratio >= fraction,
    answered: answered.length,
    of: total,
    ratio: Number(ratio.toFixed(3)),
    // A query the adjudicator says nothing fits is a piece of the need that
    // survived. Reported so a partial closure is visibly partial rather than
    // rounding to success.
    still_unmet: stillOpen.map((v) => v.query),
    // Answered by SOMETHING ELSE, which means the need was already met and the
    // gap was a retrieval failure rather than an absence.
    answered_by_others: verdicts
      .filter((v) => v.tool_id && v.tool_id !== toolId)
      .map((v) => ({ query: v.query, tool_id: v.tool_id })),
  };
}

// Has the closing tool earned the trust the bounty is meant to reward?
//
// Independent means: not the claimant. A tool used only by the person who
// published it has demonstrated nothing, and the self-call rule already keeps
// those calls out of mass — this is the same idea, stated where the money is.
export function adoption(row, claimantOwner, min = MIN_INDEPENDENT_CALLERS) {
  const callers = row?.distinct_callers ?? 0;
  const owners = row?.distinct_owners ?? 0;
  const soleOwner = owners === 1 && claimantOwner && row?.only_owner === claimantOwner;

  return {
    adopted: callers >= min && !soleOwner,
    distinct_callers: callers,
    distinct_owners: owners,
    brightness: row?.brightness ?? null,
    needed: min,
  };
}

// The whole decision, in the order the money cares about.
//
// Ordered so the cheapest refusal comes first and so a claim that fails for two
// reasons reports the one that matters: a manufactured need is not worth
// running a closure test on.
export function assessClaim({ summary, claimantOwner, verdicts, toolId, row, rule }) {
  const elig = eligibility(summary, claimantOwner, rule);
  if (!elig.eligible) {
    return { award: false, stage: "eligibility", ...elig };
  }

  const close = closure(verdicts, toolId);
  if (!close.closed) {
    return { award: false, stage: "closure", eligibility: elig, ...close };
  }

  const adopt = adoption(row, claimantOwner);
  if (!adopt.adopted) {
    return {
      award: false, stage: "adoption", eligibility: elig, closure: close, ...adopt,
      // Not a refusal, a wait. The distinction matters to whoever is looking at
      // a claim that will probably pay next month.
      pending: true,
    };
  }

  return { award: true, stage: "awarded", eligibility: elig, closure: close, adoption: adopt };
}
