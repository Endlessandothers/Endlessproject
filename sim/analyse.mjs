#!/usr/bin/env node
// Score the blind run against truth.json, and derive the two guessed numbers.
//
//   node sim/analyse.mjs
//
// The Phase 1 findings named cluster_similarity (0.5) and RULE.min_callers (3)
// as guesses sitting in exactly the position T was in when it gave 0% false
// gaps on its own set and 31.6% on a held-out one. This is what replaces them
// with something measured.
//
// Two questions, in order of importance:
//
//   1. Is there a threshold that works at all? If the similarity WITHIN a need
//      and the similarity ACROSS needs overlap, no single number separates
//      them and the right answer is to stop looking for one — which would be a
//      finding, not a failure.
//   2. If there is, where is it, and how much room is there either side?
//
// Reads the simulation's own snapshot, never the public board.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cosine, cluster, summarise, assess } from "../infra/lambda/cluster/cluster.mjs";
import { unpackVector } from "../infra/lambda/cluster/vector.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REGION = process.env.AWS_REGION || "us-east-1";
const PREFIX = process.env.ENDLESS_PREFIX || "endless-p0";

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

const rawPersonas = readFileSync(join(HERE, "personas.json"), "utf8");
const sha = createHash("sha256").update(rawPersonas.replace(/\r\n/g, "\n"), "utf8").digest("hex");
const frozen = existsSync(join(HERE, "personas.sha256"))
  ? readFileSync(join(HERE, "personas.sha256"), "utf8").trim().split(/\s+/)[0]
  : null;
if (frozen && frozen !== sha) {
  console.error(C.red("personas.json changed after freezing. Refusing to report numbers."));
  process.exit(2);
}

const truth = JSON.parse(readFileSync(join(HERE, "truth.json"), "utf8"));

// Which need each request belongs to, from the labels written before the run.
const needOf = new Map();
for (const n of truth.needs) for (const t of n.requests) needOf.set(t, n.id);
for (const t of truth.singletons) needOf.set(t, null);

// ---------------------------------------------------------------- load
const aws = (args) => JSON.parse(execFileSync("aws", [...args, "--region", REGION],
  { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).toString());

const rows = (aws(["dynamodb", "scan", "--table-name", `${PREFIX}-gaps`]).Items ?? [])
  .filter((i) => i.simulated?.BOOL === true && i.vec_b64?.S)
  .map((i) => ({
    query: i.query.S,
    caller_id: i.caller_id?.S ?? null,
    owner: i.owner?.S ?? null,
    ts: i.ts.S,
    caller_created_at: i.caller_created_at?.S ?? null,
    actor_verified: i.actor_verified?.BOOL === true,
    vector: unpackVector(i.vec_b64.S),
    need: needOf.has(i.query.S) ? needOf.get(i.query.S) : undefined,
  }));

if (!rows.length) {
  console.error(C.red("no simulated gaps found — run: node sim/run.mjs"));
  process.exit(1);
}

const unlabelled = rows.filter((r) => r.need === undefined);
console.log(`\n  ${rows.length} simulated gaps with vectors` +
            (unlabelled.length ? C.yellow(`  (${unlabelled.length} not in truth.json)`) : ""));

// ---------------------------------------------------------------- distributions
//
// The whole question in one table. Every pair of requests that truth.json says
// is the SAME need, against every pair it says are DIFFERENT needs.
const within = [];
const across = [];
const labelled = rows.filter((r) => r.need !== undefined);

for (let i = 0; i < labelled.length; i++) {
  for (let j = i + 1; j < labelled.length; j++) {
    const a = labelled[i], b = labelled[j];
    const s = cosine(a.vector, b.vector);
    // Singletons (need null) are each their own need, so a pair of them is
    // across, and a singleton against anything is across.
    if (a.need !== null && a.need === b.need) within.push({ s, a: a.query, b: b.query });
    else across.push({ s, a: a.query, b: b.query, na: a.need, nb: b.need });
  }
}

const stats = (xs) => {
  const v = xs.map((x) => x.s).sort((p, q) => p - q);
  const at = (f) => v[Math.min(v.length - 1, Math.floor(v.length * f))];
  return { n: v.length, min: v[0], p05: at(0.05), p25: at(0.25), p50: at(0.5), p75: at(0.75), p95: at(0.95), max: v.at(-1) };
};
const w = stats(within), x = stats(across);
const f = (n) => n.toFixed(4).padStart(8);

console.log(`\n${C.bold("  similarity distributions")}\n`);
console.log(`  ${"".padEnd(10)}${"n".padStart(5)}${"min".padStart(9)}${"p05".padStart(9)}${"p50".padStart(9)}${"p95".padStart(9)}${"max".padStart(9)}`);
console.log(`  ${"within".padEnd(10)}${String(w.n).padStart(5)}${f(w.min)}${f(w.p05)}${f(w.p50)}${f(w.p95)}${f(w.max)}`);
console.log(`  ${"across".padEnd(10)}${String(x.n).padStart(5)}${f(x.min)}${f(x.p05)}${f(x.p50)}${f(x.p95)}${f(x.max)}`);

// The margin. If within-p05 sits above across-p95 there is clear air between
// the two populations and a threshold can live in it. If not, any threshold
// trades one error for the other and the honest answer is to say so.
const margin = w.p05 - x.p95;
console.log(`\n  separation (within p05 − across p95): ${C.bold(margin.toFixed(4))}` +
            (margin > 0 ? C.green("   clear air") : C.red("   OVERLAP — no clean threshold exists")));

// ---------------------------------------------------------------- sweep
//
// Score every candidate threshold against the labels, the way alpha and T were
// swept in Phase 0 rather than chosen.
console.log(`\n${C.bold("  threshold sweep")}  ${C.dim("pair-level, against truth.json")}\n`);
console.log(`  ${"T".padEnd(8)}${"merged".padStart(8)}${"split".padStart(8)}${"prec".padStart(8)}${"recall".padStart(8)}${"F1".padStart(8)}   needs found`);

const candidates = [];
for (let t = 0.20; t <= 0.85; t += 0.025) {
  const tp = within.filter((p) => p.s >= t).length;
  const fp = across.filter((p) => p.s >= t).length;   // wrongly merged
  const fn = within.length - tp;                       // wrongly split
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = within.length ? tp / within.length : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;

  // How many of the labelled needs come back as one clean cluster.
  const groups = cluster(labelled, t);
  const recovered = truth.needs.filter((n) => {
    const want = new Set(n.requests);
    return groups.some((g) =>
      g.length === want.size && g.every((m) => want.has(m.query)));
  }).length;

  candidates.push({ t, precision, recall, f1, fp, fn, recovered });
  const mark = fp === 0 && fn === 0 ? C.green(" ←  perfect") : "";
  console.log(`  ${t.toFixed(3).padEnd(8)}${String(fp).padStart(8)}${String(fn).padStart(8)}` +
              `${precision.toFixed(3).padStart(8)}${recall.toFixed(3).padStart(8)}${f1.toFixed(3).padStart(8)}` +
              `   ${recovered}/${truth.needs.length}${mark}`);
}

// Prefer the widest band of thresholds that are all perfect, and take its
// middle — a value sitting in the centre of a plateau survives a shift in the
// score scale, which is exactly what T failed to do in Phase 0.
const perfect = candidates.filter((c) => c.fp === 0 && c.fn === 0);
let recommended;
if (perfect.length) {
  recommended = perfect[Math.floor(perfect.length / 2)];
  console.log(`\n  ${perfect.length} thresholds separate the set perfectly, ` +
              `from ${perfect[0].t.toFixed(3)} to ${perfect.at(-1).t.toFixed(3)}.`);
  console.log(`  ${C.bold(`recommended cluster_similarity = ${recommended.t.toFixed(3)}`)}` +
              C.dim("  (middle of the plateau, not its edge)"));
} else {
  recommended = candidates.reduce((best, c) => (c.f1 > best.f1 ? c : best), candidates[0]);
  console.log(`\n  ${C.yellow("No threshold separates the set cleanly.")}`);
  console.log(`  Best F1 ${recommended.f1.toFixed(3)} at ${recommended.t.toFixed(3)} ` +
              `(${recommended.fp} wrongly merged, ${recommended.fn} wrongly split).`);
}

// ---------------------------------------------------------------- hard pairs
console.log(`\n${C.bold("  the pairs that should stay apart")}\n`);
const bestOf = (idA, idB) => {
  const A = labelled.filter((r) => r.need === idA);
  const B = labelled.filter((r) => r.need === idB);
  let top = -1, pair = null;
  for (const a of A) for (const b of B) {
    const s = cosine(a.vector, b.vector);
    if (s > top) { top = s; pair = [a.query, b.query]; }
  }
  return { top, pair };
};
for (const hp of truth.hard_pairs) {
  const { top, pair } = bestOf(hp.a, hp.b);
  if (!pair) continue;
  const merged = top >= recommended.t;
  console.log(`  ${merged ? C.red("MERGED") : C.green("apart ")}  ${hp.a} / ${hp.b}` +
              C.dim(`   closest ${top.toFixed(4)} vs T ${recommended.t.toFixed(3)}`));
  if (merged) console.log(`          ${C.dim(`"${pair[0]}"  ~  "${pair[1]}"`)}`);
}

// ---------------------------------------------------------------- owners
//
// The anti-manufacturing rule, checked against labels rather than asserted.
console.log(`\n${C.bold("  distinct owners per need")}  ${C.dim("labelled vs measured")}\n`);
const groups = cluster(labelled, recommended.t);
let ownerErrors = 0;
for (const n of truth.needs) {
  const want = new Set(n.requests);
  // The LARGEST overlapping group, not the first.
  //
  // Picking the first reported site-up as 1 owner instead of 3: one of its four
  // requests ("is example.com responding") sits alone below the threshold, and
  // that orphan happened to come first. The clustering was right and the
  // measurement was wrong, which is the more dangerous way round.
  const overlapping = groups
    .map((grp) => ({ grp, hits: grp.filter((m) => want.has(m.query)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  const g = overlapping[0]?.grp;
  const measured = g ? summarise(g).distinct_owners : 0;
  const covered = overlapping[0]?.hits ?? 0;
  const stranded = n.requests.length - covered;
  const ok = measured === n.expected_distinct_owners;
  if (!ok) ownerErrors++;
  console.log(`  ${ok ? C.green("ok  ") : C.red("DIFF")}  ${n.id.padEnd(20)} ` +
              `labelled ${n.expected_distinct_owners}  measured ${measured}` +
              (stranded ? C.dim(`   ${stranded} of ${n.requests.length} requests left out of the main group`) : ""));
}

// ---------------------------------------------------------------- min_callers
console.log(`\n${C.bold("  min_callers sweep")}  ${C.dim("how many needs would be shown at each bar")}\n`);
for (let m = 1; m <= 5; m++) {
  const shown = groups.filter((g) => {
    const s = summarise(g);
    return s.distinct_owners >= m && s.distinct_callers >= m && s.spread_days >= 1;
  });
  const real = shown.filter((g) => {
    const first = g[0];
    const n = truth.needs.find((t) => t.id === first.need);
    return n && n.expected_distinct_owners >= m;
  }).length;
  console.log(`  min ${m}:  ${String(shown.length).padStart(2)} needs shown, ` +
              `${real} of them labelled as having that many owners` +
              (shown.length > real ? C.red(`   ${shown.length - real} would be shown on too little evidence`) : ""));
}

console.log(`\n${C.bold("  summary")}`);
console.log(`    separation      ${margin > 0 ? C.green(margin.toFixed(4)) : C.red("overlap")}`);
console.log(`    similarity      ${C.bold(recommended.t.toFixed(3))} ${C.dim("(current default 0.5)")}`);
console.log(`    owner counts    ${ownerErrors === 0 ? C.green("all as labelled") : C.red(`${ownerErrors} wrong`)}`);
console.log(`    needs recovered ${recommended.recovered}/${truth.needs.length}\n`);
