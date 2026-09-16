// Recall@k harness — issue #11.
//
// Runs all 60 frozen queries through the deployed search endpoint, scores them
// against eval/labels.json, and writes the raw per-query results so issue #12
// can derive threshold T from the real score distributions rather than a guess.
//
//   node eval/harness.mjs            run and write eval/results/<stamp>.json
//   node eval/harness.mjs --dry      show what would run, call nothing
//
// Deliberately calls the real Lambda rather than reimplementing ranking. A
// harness that scores its own copy of the algorithm measures the copy.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const FN = "endless-p0-search";
const REGION = "us-east-1";
// Ask for the whole corpus, not just the top 3. An offline fusion sweep has to
// be able to re-rank every tool, and a truncated list silently caps it.
const K = 19;

const queriesDoc = JSON.parse(readFileSync(join(HERE, "queries.json"), "utf8"));
const labelsDoc = JSON.parse(readFileSync(join(HERE, "labels.json"), "utf8"));

// The freeze is enforced, not trusted. If a query was edited after labelling,
// every number below would be measuring a different set than the one labelled.
const canon = queriesDoc.queries.map((q) => `${q.id}\t${q.text}`).join("\n");
const sha = createHash("sha256").update(canon).digest("hex");
if (sha !== labelsDoc.queries_sha256) {
  console.error("FROZEN SET MISMATCH");
  console.error(`  queries.json : ${sha}`);
  console.error(`  labels.json  : ${labelsDoc.queries_sha256}`);
  console.error("The query set changed after labelling. Refusing to report numbers.");
  process.exit(2);
}
console.log(`frozen set verified: ${sha.slice(0, 16)}…  n=${queriesDoc.queries.length}\n`);

const labelById = new Map(labelsDoc.labels.map((l) => [l.id, l]));
const dry = process.argv.includes("--dry");

function search(query) {
  const event = {
    version: "2.0", rawPath: "/search",
    requestContext: { http: { method: "POST" } },
    isBase64Encoded: false,
    body: JSON.stringify({
      query, k: K,
      actor: { agent_id: "eval-harness", session_id: labelsDoc.labelled_at },
    }),
  };
  const pj = join(tmpdir(), `eval-${Math.random().toString(36).slice(2)}.json`);
  const oj = `${pj}.out`;
  writeFileSync(pj, JSON.stringify(event));
  execFileSync("aws", [
    "lambda", "invoke", "--region", REGION, "--function-name", FN,
    "--cli-binary-format", "raw-in-base64-out", "--payload", `file://${pj}`, oj,
  ], { stdio: "pipe" });
  return JSON.parse(JSON.parse(readFileSync(oj, "utf8")).body);
}

const rows = [];
for (const q of queriesDoc.queries) {
  const label = labelById.get(q.id) ?? { expect: null, confidence: "high" };
  if (dry) {
    rows.push({ ...q, expect: label.expect });
    continue;
  }
  const res = search(q.text);
  const ranked = res.results.map((r) => r.tool_id);
  rows.push({
    id: q.id, text: q.text,
    expect: label.expect ?? null,
    confidence: label.confidence ?? "high",
    contaminated: label.contaminated === true,
    top: ranked[0] ?? null,
    top_score: res.results[0]?.score ?? null,
    ranked, scores: res.results.map((r) => r.score),
    components: res.results.map((r) => ({ tool_id: r.tool_id, cosine: r.cosine, lexical: r.lexical })),
    fusion_alpha: res.fusion_alpha,
    gap_logged: res.gap_logged, threshold_t: res.threshold_t,
  });
  process.stdout.write(".");
}
if (dry) {
  console.log(`dry run: ${rows.length} queries, ${rows.filter((r) => r.expect).length} answerable`);
  process.exit(0);
}
console.log("\n");

function metrics(subset) {
  const answerable = subset.filter((r) => r.expect);
  const unanswerable = subset.filter((r) => !r.expect);
  const hit1 = answerable.filter((r) => r.top === r.expect).length;
  const hit3 = answerable.filter((r) => r.ranked.slice(0, 3).includes(r.expect)).length;
  // A false gap: a tool existed, and the system logged a gap anyway.
  const falseGap = answerable.filter((r) => r.gap_logged).length;
  // Gap detection: nothing could answer, and the system said so.
  const detected = unanswerable.filter((r) => r.gap_logged).length;
  return {
    n: subset.length, answerable: answerable.length, unanswerable: unanswerable.length,
    recall1: answerable.length ? hit1 / answerable.length : null,
    recall3: answerable.length ? hit3 / answerable.length : null,
    false_gap_rate: answerable.length ? falseGap / answerable.length : null,
    gap_detection_rate: unanswerable.length ? detected / unanswerable.length : null,
  };
}

const all = metrics(rows);
const clean = metrics(rows.filter((r) => !r.contaminated));
const pct = (v) => (v === null ? "  n/a" : (v * 100).toFixed(1).padStart(5) + "%");

console.log("                        all queries   excluding contaminated");
console.log(`  n                     ${String(all.n).padStart(11)}   ${String(clean.n).padStart(9)}`);
console.log(`  answerable            ${String(all.answerable).padStart(11)}   ${String(clean.answerable).padStart(9)}`);
console.log(`  unanswerable          ${String(all.unanswerable).padStart(11)}   ${String(clean.unanswerable).padStart(9)}`);
console.log(`  recall@1              ${pct(all.recall1).padStart(11)}   ${pct(clean.recall1).padStart(9)}`);
console.log(`  recall@3              ${pct(all.recall3).padStart(11)}   ${pct(clean.recall3).padStart(9)}`);
console.log(`  false-gap rate        ${pct(all.false_gap_rate).padStart(11)}   ${pct(clean.false_gap_rate).padStart(9)}`);
console.log(`  gap-detection rate    ${pct(all.gap_detection_rate).padStart(11)}   ${pct(clean.gap_detection_rate).padStart(9)}`);

const GATE_R3 = 0.9, GATE_GAP = 0.8;
console.log("\nGATE");
console.log(`  recall@3 >= ${GATE_R3}          ${all.recall3 >= GATE_R3 ? "PASS" : "FAIL"}`);
console.log(`  gap detection >= ${GATE_GAP}     ${all.gap_detection_rate >= GATE_GAP ? "PASS" : "FAIL"}`);

// Score distributions — the input #12 needs to derive T.
const ansScores = rows.filter((r) => r.expect && r.top === r.expect).map((r) => r.top_score).sort((a, b) => a - b);
const unaScores = rows.filter((r) => !r.expect).map((r) => r.top_score).sort((a, b) => a - b);
const q = (arr, p) => (arr.length ? arr[Math.floor((arr.length - 1) * p)] : null);
const f = (v) => (v === null ? "n/a" : v.toFixed(4));
console.log("\nTOP-SCORE DISTRIBUTIONS  (what #12 derives T from)");
console.log(`  correct hits    n=${String(ansScores.length).padStart(2)}  min ${f(q(ansScores,0))}  p25 ${f(q(ansScores,0.25))}  median ${f(q(ansScores,0.5))}  max ${f(q(ansScores,1))}`);
console.log(`  no-answer tops  n=${String(unaScores.length).padStart(2)}  min ${f(q(unaScores,0))}  p50 ${f(q(unaScores,0.5))}  p75 ${f(q(unaScores,0.75))}  max ${f(q(unaScores,1))}`);
const overlap = ansScores.length && unaScores.length ? q(unaScores, 1) >= q(ansScores, 0) : false;
console.log(`  overlap: ${overlap ? "YES — no single threshold separates them cleanly" : "no"}`);

const outDir = join(HERE, "results");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = join(outDir, `${stamp}.json`);
writeFileSync(out, JSON.stringify({
  ran_at: new Date().toISOString(), queries_sha256: sha,
  corpus: labelsDoc.corpus, k: K, metrics: { all, excluding_contaminated: clean },
  distributions: { correct_hits: ansScores, no_answer_tops: unaScores },
  rows,
}, null, 2));
console.log(`\nraw results: eval/results/${stamp}.json`);
