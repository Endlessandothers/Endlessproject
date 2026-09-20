// Agents building tools — Phase 3.
//
// Pure: no AWS imports, so the rules deciding whether a machine may write and
// publish code are testable without credentials.
//
// THE DECISION THIS PHASE TURNS ON: A GENERATED TOOL STILL NEEDS APPROVAL.
//
// It is tempting to exempt it. The sandbox is proven — 22 live escape attacks,
// no route, no useful credentials, no reachable filesystem — so generated code
// can do no more damage than a human's. And the Done-when asks for "a recurring
// gap closed by a tool no human wrote", which sounds like it wants nobody in the
// loop at all.
//
// It is not exempted, and here is why:
//
// CLAUDE.md is explicit that sandboxing gates execution and that nothing runs
// "because it came from a verified source". A generated tool is not a verified
// source; it is the least verified source there has ever been.
//
// And the builder is the PLATFORM. If the platform could approve its own
// output, the review gate would protect against every party except the one with
// the most access — which is the confused-deputy shape this codebase has already
// refused twice, in exec-fn and in mcp-fn.
//
// A human approving is not a human writing. The Done-when is satisfied honestly
// by a person reading code they did not author and deciding whether it may run.
// Full autonomy needs an independent judge of code, which does not exist here,
// and inventing one by asking the same platform twice is not independence.

// Generated packages are held to a tighter envelope than a person's.
//
// Not because generated code is more dangerous inside the sandbox — it is not —
// but because a reviewer reading something no human wrote has less context to
// judge it with. Every constraint below exists to make the review possible.
export const GENERATED_MAX_SOURCE = 16 * 1024;
export const GENERATED_RUNTIME = "lambda-vpc";
export const GENERATED_MAX_REQUESTS = 2;

// How many of a cluster's queries ONE existing tool must already answer before
// generating is refused as duplication.
//
// PROJECT.md calls near-duplicate generation "the most likely failure" and says
// it "inflates the world without adding to it", which argues for a low bar. The
// opposite pressure is just as real: refuse too readily and a genuine need stays
// unmet because one query in it happened to match something.
//
// A clear majority is where those balance. If one tool already answers most of
// the cluster, the remainder is a retrieval problem or a description problem,
// and a second tool competing with the first fixes neither. Below that, most of
// the need is unmet and building is the honest response.
//
// PROVISIONAL. It was 0.34 for one draft, which refused generation whenever a
// single query in three matched — a rule that would have blocked closing a need
// that was two thirds absent. Nothing has enough clusters to derive it from yet.
export const DUPLICATE_FRACTION = 0.5;

// Should anything be generated for this cluster at all?
//
// verdicts is one entry per cluster query: { query, tool_id } from the
// adjudicator — the same mechanism that decided the gap. If it now says an
// existing tool fits, the gap was a retrieval failure rather than an absence,
// and the fix is not a new tool.
export function duplicateCheck(verdicts, fraction = DUPLICATE_FRACTION) {
  const total = verdicts.length;
  const answered = verdicts.filter((v) => v.tool_id);
  const byTool = new Map();
  for (const v of answered) byTool.set(v.tool_id, (byTool.get(v.tool_id) ?? 0) + 1);

  const [topTool, topCount] = [...byTool.entries()]
    .sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const ratio = total ? topCount / total : 0;

  if (!total) {
    return { generate: false, reason: "no queries to build against" };
  }
  if (ratio >= fraction) {
    return {
      generate: false,
      reason: `${topTool} already answers ${topCount} of ${total} queries — this is a retrieval problem, not a missing tool`,
      duplicate_of: topTool,
      ratio: Number(ratio.toFixed(3)),
    };
  }
  return { generate: true, ratio: Number(ratio.toFixed(3)), partial_matches: answered.length };
}

// What the builder is told.
//
// The CLUSTER, never one query. PROJECT.md: "Build against the gap cluster, not
// against a one-off query — the cluster is what carries the evidence of real
// demand." A tool built to satisfy one phrasing satisfies one phrasing.
export function brief(cluster) {
  const queries = [...new Set(cluster.queries ?? [])];
  return {
    need: cluster.label,
    queries,
    // The evidence, so a builder can see this is a real need rather than one
    // request. Counts only — who asked is nobody's business, including the
    // builder's.
    distinct_callers: cluster.distinct_callers ?? 0,
    spread_days: cluster.spread_days ?? 0,
    sufficient: queries.length > 0 && (cluster.distinct_callers ?? 0) > 0,
  };
}

// The safety envelope, applied before a generated package is ever offered for
// review. Failing fast here means a reviewer never spends attention on
// something that was never going to be allowed.
export function validateGenerated(pkg) {
  const errors = [];
  if (!pkg || typeof pkg !== "object") return ["no package"];

  const src = pkg.handler_source;
  if (typeof src !== "string" || !src.length) {
    errors.push("handler_source is required");
  } else if (src.length > GENERATED_MAX_SOURCE) {
    errors.push(`generated handler is ${src.length} bytes, the limit is ${GENERATED_MAX_SOURCE}`);
  }

  // Fargate is the runtime that leaves the free tier and bills per second.
  // Nothing a generator produces has yet earned the right to ask for it.
  if ((pkg.runtime ?? GENERATED_RUNTIME) !== GENERATED_RUNTIME) {
    errors.push(`generated tools run on ${GENERATED_RUNTIME}, not ${pkg.runtime}`);
  }

  const requests = pkg.requests ?? [];
  if (requests.length > GENERATED_MAX_REQUESTS) {
    errors.push(`${requests.length} requests exceeds the generated limit of ${GENERATED_MAX_REQUESTS}`);
  }

  // A generator that declares no allowlist and no requests has written a pure
  // transform, which is fine. One that declares hosts must declare all of them,
  // and registry-fn checks that independently at publication.
  for (const r of requests) {
    if (!r?.url) { errors.push("every request needs a url"); continue; }
    if (!String(r.url).startsWith("https://")) errors.push(`${r.id ?? "request"}: https only`);
  }

  return errors;
}

// Which declared hosts the registry has never seen approved before.
//
// Not a refusal. A new upstream is exactly what closing a novel gap requires.
// It is the single most useful thing to put in front of a reviewer, because it
// is the one claim in a generated package that nothing else can check.
export function novelHosts(pkg, approvedHosts) {
  const seen = new Set(approvedHosts);
  return [...new Set(pkg?.allowlist ?? [])].filter((h) => !seen.has(h));
}

// What the closure judge is allowed to see.
//
// docs/deferred-corrections.md, filed against this phase: "the adjudicator
// judging a tool the builder just generated is still the system marking its own
// homework, only one level up... Worth confirming the adjudicator is not given
// the fact that the candidate was auto-generated."
//
// So it is stripped here rather than trusted not to matter. The judge sees what
// it sees for any other candidate — an id, a name, a description — and cannot
// favour or distrust a generated tool because it cannot tell.
export function judgeView(tool) {
  return {
    tool_id: tool.tool_id,
    name: tool.name,
    description: tool.description,
  };
}
