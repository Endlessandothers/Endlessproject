#!/usr/bin/env node
// endless — read the registry, run searches, and read the miss log by hand.
//
// Issue #13. The roadmap's Done-when for Phase 0 is "you can point at logged
// gaps that are genuinely unsolved needs, not search failures", and that is a
// judgement a person makes by reading them. This is the thing you read them in.
//
//   endless search "what will the weather do tomorrow"
//   endless gaps            list recent gaps, newest first
//   endless gaps <id>       one gap in full, with the shortlist it rejected
//   endless tools           what is registered
//   endless events          recent activity
//
// Shells out to the aws CLI rather than taking an SDK dependency, so it runs
// from a clean checkout with nothing installed but node and aws.

import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REGION = process.env.AWS_REGION || "us-east-1";
const PREFIX = process.env.ENDLESS_PREFIX || "endless-p0";

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
    return JSON.parse(execFileSync("aws", [...args, "--region", REGION], {
      stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024,
    }).toString() || "{}");
  } catch (err) {
    const msg = (err.stderr?.toString() || err.message).trim().split("\n").pop();
    console.error(C.red(`aws call failed: ${msg}`));
    process.exit(1);
  }
}

// DynamoDB's wire format is nested type tags; flatten it so the rest of this
// file deals in plain values.
function plain(v) {
  if (v === null || v === undefined) return null;
  if ("S" in v) return v.S;
  if ("N" in v) return Number(v.N);
  if ("BOOL" in v) return v.BOOL;
  if ("NULL" in v) return null;
  if ("L" in v) return v.L.map(plain);
  if ("M" in v) return Object.fromEntries(Object.entries(v.M).map(([k, x]) => [k, plain(x)]));
  return v;
}
const flatten = (item) => Object.fromEntries(Object.entries(item).map(([k, v]) => [k, plain(v)]));

const scan = (table) =>
  (aws(["dynamodb", "scan", "--table-name", `${PREFIX}-${table}`]).Items || []).map(flatten);

function invoke(fn, payload) {
  const pj = join(tmpdir(), `endless-${Date.now()}.json`);
  const oj = `${pj}.out`;
  writeFileSync(pj, JSON.stringify(payload));
  aws(["lambda", "invoke", "--function-name", `${PREFIX}-${fn}`,
       "--cli-binary-format", "raw-in-base64-out", "--payload", `file://${pj}`, oj]);
  const res = JSON.parse(readFileSync(oj, "utf8"));
  return JSON.parse(res.body);
}

const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

// ---------------------------------------------------------------- commands
function cmdSearch(query) {
  if (!query) return fail('usage: endless search "<query>"');
  const res = invoke("search", {
    version: "2.0", rawPath: "/search",
    requestContext: { http: { method: "POST" } }, isBase64Encoded: false,
    body: JSON.stringify({
      query, k: 5,
      actor: { agent_id: "cli", session_id: `cli-${process.pid}` },
    }),
  });
  if (res.error) return fail(res.error);

  console.log(`\n  ${C.bold(query)}\n`);
  for (const [i, r] of res.results.entries()) {
    const bar = "█".repeat(Math.max(1, Math.round(r.score * 40)));
    const parts = r.cosine !== undefined
      ? C.dim(`  meaning ${r.cosine.toFixed(3)}  words ${r.lexical.toFixed(3)}`)
      : "";
    console.log(`  ${i === 0 ? C.cyan("→") : " "} ${r.score.toFixed(4)} ${C.dim(bar)}`);
    console.log(`    ${C.bold(r.tool_id)}@${r.version}${parts}`);
  }
  console.log();
  if (res.gap_logged) {
    console.log(`  ${C.yellow("GAP LOGGED")}  nothing here does the job`);
    console.log(C.dim(`  decided by ${res.decided_by || "threshold"}   id ${res.gap_id}`));
  } else {
    console.log(`  ${C.green("answered")}  ${C.dim(`decided by ${res.decided_by || "threshold"}`)}`);
  }
  if (res.judge_error) console.log(C.red(`  judge fell back: ${res.judge_error}`));
  console.log();
}

function cmdGaps(id, limit) {
  const gaps = scan("gaps").sort((a, b) => String(b.ts).localeCompare(String(a.ts)));

  if (id) {
    const g = gaps.find((x) => x.gap_id === id || x.gap_id?.startsWith(id));
    if (!g) return fail(`no gap matching "${id}"`);
    console.log(`\n  ${C.bold(g.query)}\n`);
    console.log(`  ${C.dim("logged")}      ${g.ts}  (${ago(g.ts)})`);
    console.log(`  ${C.dim("reason")}      ${g.reason}`);
    console.log(`  ${C.dim("decided by")}  ${g.decided_by || `threshold at ${g.threshold_t}`}`);
    console.log(`  ${C.dim("agent")}       ${g.actor?.agent_id} / ${g.actor?.session_id}`);
    console.log(`\n  ${C.dim("it looked at and rejected:")}`);
    for (const r of g.top_k || []) {
      console.log(`    ${Number(r.score).toFixed(4)}  ${r.tool_id}@${r.version}`);
    }
    // The judgement the phase actually turns on.
    console.log(`\n  ${C.dim("Is this a genuine unmet need, or did search just miss?")}`);
    console.log(`  ${C.dim("That call is yours — it is the whole point of Phase 0.")}\n`);
    return;
  }

  if (!gaps.length) {
    console.log(`\n  no gaps logged yet\n`);
    return;
  }
  console.log(`\n  ${gaps.length} gap${gaps.length === 1 ? "" : "s"}, newest first\n`);
  for (const g of gaps.slice(0, limit)) {
    const best = g.top_k?.[0];
    console.log(`  ${C.dim(String(g.gap_id).slice(0, 8))}  ${C.bold(String(g.query).slice(0, 52))}`);
    console.log(`            ${C.dim(`${ago(g.ts)} · ${g.reason} · best was ${best ? `${best.tool_id} ${Number(best.score).toFixed(3)}` : "nothing"}`)}`);
  }
  console.log(C.dim(`\n  endless gaps <id>  for the full record\n`));
}

function cmdTools() {
  const latest = new Map();
  for (const t of scan("tools")) {
    const seen = latest.get(t.tool_id);
    if (!seen || Number(t.version) > Number(seen.version)) latest.set(t.tool_id, t);
  }
  const tools = [...latest.values()].sort((a, b) => a.category.localeCompare(b.category) || a.tool_id.localeCompare(b.tool_id));
  console.log(`\n  ${tools.length} tools registered\n`);
  let cat = null;
  for (const t of tools) {
    if (t.category !== cat) { cat = t.category; console.log(`  ${C.dim(cat)}`); }
    console.log(`    ${C.bold(t.tool_id)}@${t.version}  ${C.dim(String(t.description).slice(0, 62))}`);
  }
  console.log();
}

function cmdEvents(limit) {
  const events = scan("events").sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  console.log(`\n  ${events.length} events, newest first\n`);
  for (const e of events.slice(0, limit)) {
    console.log(`  ${C.dim(ago(e.ts).padStart(8))}  ${e.type}  ${C.bold(String(e.query || "").slice(0, 44))}`);
    console.log(`            ${C.dim(`${e.actor?.agent_id} · top ${e.top_score !== null ? Number(e.top_score).toFixed(3) : "-"} · ${e.result_count} results`)}`);
  }
  console.log();
}

function fail(msg) {
  console.error(C.red(`  ${msg}`));
  process.exit(1);
}

// ---------------------------------------------------------------- dispatch
const [cmd, ...rest] = process.argv.slice(2);
const limitArg = rest.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 20;
const positional = rest.filter((a) => !a.startsWith("--"));

switch (cmd) {
  case "search": cmdSearch(positional.join(" ")); break;
  case "gaps": cmdGaps(positional[0], limit); break;
  case "tools": cmdTools(); break;
  case "events": cmdEvents(limit); break;
  default:
    console.log(`
  ${C.bold("endless")} — Phase 0 inspection

    endless search "<query>"    run a search and see the gap decision
    endless gaps                recent gaps, newest first
    endless gaps <id>           one gap in full, with what it rejected
    endless tools               what is registered
    endless events              recent activity

  ${C.dim(`region ${REGION} · prefix ${PREFIX}`)}
`);
}
