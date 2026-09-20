#!/usr/bin/env node
// closure — did the need actually close? Phase 3, issue #5.
//
//   node cli/closure.mjs <cluster_id> <tool_id> [--simulated]
//
// This is the Done-when. Everything before it proves a tool can be written;
// only this proves a need was met.
//
// PROJECT.md: "A gap does not close because something was published; it closes
// because the need is met." So the test re-runs the originating queries — every
// phrasing in the cluster, not the one the tool was named after — and asks
// whether each now resolves to the new tool.
//
// JUDGED, NOT SCORED.
//
// docs/deferred-corrections.md filed this before any of it was built:
// PROJECT.md defined closure as the queries resolving "above threshold", and
// Phase 0 had already measured that a threshold fitted to one query set gave 0%
// false gaps on it and 31.6% on a held-out one. Closure decided by a moving
// number can be true on Monday and false on Wednesday with nothing about the
// tool having changed.
//
// So it asks the adjudicator, per query — the same mechanism that decided the
// gap in the first place. If the two could disagree, the system could report a
// need and its closure in the same breath.
//
// AND THE JUDGE CANNOT TELL WHAT WROTE IT.
//
// The adjudicator sees a tool_id, a name and a description, exactly as it does
// for any other candidate. It is never told the tool was generated, which
// cluster it was built for, or which model wrote it. Enforced in judgeView; a
// generated tool and a person's tool produce a byte-identical view.
//
// It is not full independence — the same platform supplies the builder and the
// judge. It removes the one signal that could bias the judge either way, which
// is what was actually available.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closure } from "../infra/lambda/cluster/bounty.mjs";

const REGION = process.env.AWS_REGION || "us-east-1";
const PREFIX = process.env.ENDLESS_PREFIX || "endless-p0";
const KEY = process.env.ENDLESS_API_KEY;

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

const aws = (args) => JSON.parse(execFileSync("aws", [...args, "--region", REGION],
  { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).toString() || "{}");

function search(query) {
  const p = join(tmpdir(), `cl-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify({
    version: "2.0", rawPath: "/search", isBase64Encoded: false,
    requestContext: { http: { method: "POST" } },
    headers: { authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ query, k: 5, actor: { agent_id: "closure-test", session_id: "s1" } }),
  }));
  execFileSync("aws", ["lambda", "invoke", "--region", REGION, "--function-name", `${PREFIX}-search`,
    "--cli-binary-format", "raw-in-base64-out", "--payload", `file://${p}`, `${p}.out`], { stdio: "pipe" });
  return JSON.parse(JSON.parse(readFileSync(`${p}.out`, "utf8")).body);
}

const args = process.argv.slice(2);
const [clusterId, toolId] = args.filter((a) => !a.startsWith("--"));
if (!clusterId || !toolId) {
  console.error("  usage: node cli/closure.mjs <cluster_id> <tool_id> [--simulated]");
  process.exit(1);
}
if (!KEY) {
  console.error(C.red("  set ENDLESS_API_KEY — the closure test searches as an ordinary caller"));
  process.exit(1);
}

const bucket = `${PREFIX}-board-${aws(["sts", "get-caller-identity"]).Account}`;
const key = args.includes("--simulated") ? "sim-gaps.json" : "gaps.json";
const out = join(tmpdir(), `cg-${Date.now()}.json`);
execFileSync("aws", ["s3", "cp", `s3://${bucket}/${key}`, out, "--region", REGION], { stdio: "pipe" });
const cluster = (JSON.parse(readFileSync(out, "utf8")).clusters ?? []).find((c) => c.id === clusterId);
if (!cluster) { console.error(C.red(`  no cluster ${clusterId}`)); process.exit(1); }

// The tool has to be approved, or the test is meaningless: an unapproved tool
// cannot be called, so "the need is met" would be false whatever search says.
const approval = aws(["dynamodb", "get-item", "--table-name", `${PREFIX}-approvals`,
  "--key", JSON.stringify({ tool_id: { S: toolId }, version: { S: "0001" } })]).Item;
const decision = approval?.decision?.S ?? "never reviewed";

console.log(`\n  ${C.bold(cluster.label)}`);
console.log(`  ${C.dim(`${cluster.queries.length} phrasings · ${cluster.distinct_callers} callers · candidate ${toolId} (${decision})`)}\n`);

if (decision !== "approved") {
  console.log(`  ${C.red(`${toolId} is not approved, so it cannot answer anything.`)}`);
  console.log(`  ${C.dim(`node cli/review.mjs ${toolId} 0001`)}\n`);
  process.exit(2);
}

// Every phrasing, not the one the tool was named after.
const verdicts = cluster.queries.map((query) => {
  const body = search(query);
  const fits = body.fits ?? null;
  const mark = fits === toolId ? C.green("closed ") : fits ? C.yellow("other  ") : C.red("open   ");
  console.log(`  ${mark} ${C.dim(query.slice(0, 54).padEnd(56))}${fits ?? C.dim("nothing fits")}`);
  return { query, tool_id: fits };
});

const result = closure(verdicts, toolId);

console.log(`\n  ${result.closed ? C.green("CLOSED") : C.red("NOT CLOSED")}   ` +
            `${result.answered} of ${result.of} phrasings resolve to ${toolId}  ${C.dim(`(${(result.ratio * 100).toFixed(0)}%)`)}`);

if (result.still_unmet.length) {
  console.log(`\n  ${C.dim("still unmet:")}`);
  for (const q of result.still_unmet) console.log(`    ${C.red("·")} ${q}`);
}
if (result.answered_by_others.length) {
  // Answered by something else means the need was already met and the gap was a
  // retrieval failure — a finding about search, not about this tool.
  console.log(`\n  ${C.dim("answered by something else — these gaps were retrieval failures:")}`);
  for (const a of result.answered_by_others) console.log(`    ${C.yellow("·")} ${a.query} -> ${a.tool_id}`);
}
console.log();
