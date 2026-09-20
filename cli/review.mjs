#!/usr/bin/env node
// review — decide whether a published tool version may execute.
//
//   node cli/review.mjs                              what is waiting
//   node cli/review.mjs <tool_id> <version>          read the code before deciding
//   node cli/review.mjs <tool_id> <version> --approve [--note "..."]
//   node cli/review.mjs <tool_id> <version> --reject  --note "why"
//   node cli/review.mjs <tool_id> <version> --revoke  --note "why"
//
// Publishing and being allowed to run are two different events. A version
// nobody has looked at does not execute: exec-fn treats the absence of an
// approval as a refusal, so a missing record, a failed write and a brand new
// tool all fail the same safe way.
//
// RUNS FROM AN OPERATOR'S OWN CREDENTIALS, and no Lambda has any write on the
// approvals table. registry-fn holds PutItem on the tools table because it must,
// so if approvals lived there the function that accepts submissions could
// approve them — and compromising it would defeat the gate rather than merely
// filling it with pending entries.
//
// REVOKE IS THE TAKEDOWN PATH. It takes effect on the next call, because
// exec-fn does not cache approvals.

import { execFileSync } from "node:child_process";

const REGION = process.env.AWS_REGION || "us-east-1";
const PREFIX = process.env.ENDLESS_PREFIX || "endless-p0";
const REVIEWER = process.env.ENDLESS_REVIEWER || process.env.USERNAME || process.env.USER || "operator";

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

function aws(args) {
  try {
    return JSON.parse(execFileSync("aws", [...args, "--region", REGION],
      { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).toString() || "{}");
  } catch (err) {
    const msg = (err.stderr?.toString() || err.message).trim().split("\n").pop();
    console.error(C.red(`  aws call failed: ${msg}`));
    process.exit(1);
  }
}

const plain = (v) => {
  if (v == null) return null;
  if ("S" in v) return v.S;
  if ("N" in v) return Number(v.N);
  if ("BOOL" in v) return v.BOOL;
  if ("L" in v) return v.L.map(plain);
  if ("M" in v) return Object.fromEntries(Object.entries(v.M).map(([k, x]) => [k, plain(x)]));
  return null;
};
const flatten = (i) => Object.fromEntries(Object.entries(i).map(([k, v]) => [k, plain(v)]));

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n) => { const i = args.indexOf(`--${n}`); return i === -1 ? null : args[i + 1]; };
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

const tools = (aws(["dynamodb", "scan", "--table-name", `${PREFIX}-tools`]).Items || []).map(flatten);
const approvals = new Map(
  (aws(["dynamodb", "scan", "--table-name", `${PREFIX}-approvals`]).Items || [])
    .map(flatten).map((a) => [`${a.tool_id}@${a.version}`, a]),
);

// ---------------------------------------------------------------- queue
if (positional.length === 0) {
  // Only versions carrying code need a decision. A tool registered as metadata
  // cannot execute anything, so there is nothing to review.
  const executable = tools.filter((t) => t.handler_source);
  const rows = executable.map((t) => ({
    ref: `${t.tool_id}@${t.version}`, owner: t.owner,
    decision: approvals.get(`${t.tool_id}@${t.version}`)?.decision ?? null,
  }));
  const pending = rows.filter((r) => r.decision === null);

  console.log(`\n  ${C.bold(`${pending.length} waiting`)} of ${rows.length} executable versions\n`);
  for (const r of rows.sort((a, b) => a.ref.localeCompare(b.ref))) {
    const mark = r.decision === "approved" ? C.green("approved")
      : r.decision === "rejected" ? C.red("rejected")
      : r.decision === "revoked" ? C.red("revoked ")
      : C.yellow("PENDING ");
    console.log(`  ${mark}  ${r.ref.padEnd(28)} ${C.dim(r.owner ?? "")}`);
  }
  console.log(`\n  ${C.dim("node cli/review.mjs <tool_id> <version>   to read one before deciding")}\n`);
  process.exit(0);
}

const [toolId, version] = positional;
if (!version) {
  console.error(C.red("  a version is required — versions are approved, not tools"));
  process.exit(1);
}

const tool = tools.find((t) => t.tool_id === toolId && t.version === version);
if (!tool) {
  console.error(C.red(`  no such version: ${toolId}@${version}`));
  process.exit(1);
}

const decision = flag("approve") ? "approved" : flag("reject") ? "rejected" : flag("revoke") ? "revoked" : null;

// ---------------------------------------------------------------- read it
if (!decision) {
  const current = approvals.get(`${toolId}@${version}`);
  console.log(`\n  ${C.bold(`${toolId}@${version}`)}  ${C.dim(tool.name ?? "")}`);
  console.log(`  ${C.dim("owner")}      ${tool.owner}${tool.owner_verified ? C.green(" (verified)") : C.yellow(" (unverified — predates verified ownership)")}`);
  console.log(`  ${C.dim("runtime")}    ${tool.runtime ?? "lambda-vpc"}`);
  console.log(`  ${C.dim("status")}     ${current ? `${current.decision} by ${current.reviewer} ${current.reviewed_at}` : C.yellow("never reviewed")}`);
  console.log(`\n  ${C.dim("description")}\n    ${tool.description}`);
  console.log(`\n  ${C.dim("hosts it may reach")}  ${C.cyan((tool.allowlist ?? []).join(", ") || "none")}`);
  for (const r of tool.requests ?? []) console.log(`    ${C.dim(r.id)}  ${r.url}`);
  console.log(`\n  ${C.dim("inputs")}`);
  for (const [k, spec] of Object.entries(tool.input_schema ?? {})) {
    console.log(`    ${k} ${C.dim(`${spec.type}${spec.required ? " required" : ""}`)}`);
  }
  console.log(`\n  ${C.bold("handler source")}  ${C.dim(`${tool.handler_source.length} bytes`)}\n`);
  console.log(tool.handler_source.split("\n").map((l) => `    ${l}`).join("\n"));
  console.log(`\n  ${C.dim("--approve / --reject / --revoke  (--note recommended)")}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------- decide
const note = value("note");
if (decision !== "approved" && !note) {
  // An approval can stand on the code itself. A refusal or a takedown is a
  // decision someone will want explained later, including by you.
  console.error(C.red(`  --note is required when you ${decision.replace("ed", "")} something`));
  process.exit(1);
}

aws(["dynamodb", "put-item", "--table-name", `${PREFIX}-approvals`, "--item", JSON.stringify({
  tool_id: { S: toolId },
  version: { S: version },
  decision: { S: decision },
  reviewer: { S: REVIEWER },
  reviewed_at: { S: new Date().toISOString() },
  note: { S: note ?? "" },
  // The exact bytes that were approved. If the row this points at ever differs
  // from what runs, the approval was for something else — and versions are
  // immutable precisely so that this stays checkable.
  source_bytes: { N: String(tool.handler_source.length) },
})]);

const colour = decision === "approved" ? C.green : C.red;
console.log(`\n  ${colour(decision)}  ${C.bold(`${toolId}@${version}`)}  ${C.dim(`by ${REVIEWER}`)}`);
if (note) console.log(`  ${C.dim(note)}`);
console.log(`  ${C.dim(decision === "approved" ? "callable on the next request" : "refused from the next request — exec-fn does not cache approvals")}\n`);
