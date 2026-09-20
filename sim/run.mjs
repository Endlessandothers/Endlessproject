#!/usr/bin/env node
// Replay the blind set as twelve strangers. Phase 1 exit / Phase 2 prerequisite.
//
//   node sim/freeze.mjs          once, to stamp the checksum
//   node sim/run.mjs --mint      create the simulated callers
//   node sim/run.mjs             replay the traffic through the real MCP endpoint
//   node sim/analyse.mjs         score it against truth.json
//   node sim/run.mjs --purge     delete every trace of the simulation
//
// THROUGH THE FRONT DOOR, ON PURPOSE.
//
// Every request goes over the public MCP endpoint with a bearer key, exactly as
// an agent would send it. Not a direct Lambda invoke, not a mock. The thing
// being tested is the product a stranger would meet, and any shortcut here
// tests something else.
//
// SIMULATED AND MARKED AS SUCH.
//
// The callers are minted with --simulated, so every gap and event row they
// produce carries simulated:true, written by the platform from the caller row
// rather than from the request. The nightly job keeps them off the public
// board. Invented demand on a board that claims to show real demand would be
// the first thing these rules were built to stop, and being the one who does it
// because it was convenient is not an exception.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// Which frozen set. personas.json was written to measure clustering and is full
// of needs nothing can close — PDF parsing, OCR, uptime monitoring. That makes
// it useless for the builder: every need fails for the same reason and the path
// where generation succeeds is never exercised. builder-personas.json is the
// opposite, and every need in it is closable by a real free keyless API.
//
// Each set has its own checksum, its own labels and its own keys. Mixing them
// would make either measurement meaningless.
const SET = (process.argv.find((a) => a.startsWith("--set=")) ?? "--set=personas").slice(6);
const SET_FILE = SET === "personas" ? "personas.json" : SET + "-personas.json";
const SET_SHA = SET === "personas" ? "personas.sha256" : SET + "-personas.sha256";
const TRUTH_FILE = SET === "personas" ? "truth.json" : SET + "-truth.json";
const REGION = process.env.AWS_REGION || "us-east-1";
const PREFIX = process.env.ENDLESS_PREFIX || "endless-p0";
const KEYS_PATH = join(HERE, ".keys-" + SET + ".json"); // gitignored: these are credentials

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

const raw = readFileSync(join(HERE, SET_FILE), "utf8");
const personas = JSON.parse(raw).personas;

// The frozen set, verified the way the Phase 0 harness verifies its queries. A
// set that can be edited after seeing the results is not a blind set.
const sha = createHash("sha256").update(raw.replace(/\r\n/g, "\n"), "utf8").digest("hex");
const expected = existsSync(join(HERE, SET_SHA))
  ? readFileSync(join(HERE, SET_SHA), "utf8").trim().split(/\s+/)[0]
  : null;
if (expected && expected !== sha) {
  console.error(C.red(`${SET_FILE} changed after it was frozen. Refusing to run.`));
  console.error(`  frozen: ${expected}\n  now:    ${sha}`);
  process.exit(2);
}

const aws = (args) => execFileSync("aws", [...args, "--region", REGION],
  { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).toString();

// ---------------------------------------------------------------- mint
function mint() {
  const keys = {};
  for (const p of personas) {
    let out;
    try {
      out = execFileSync("node", [
        join(HERE, "../cli/mint-caller.mjs"), p.caller_id,
        "--owner", p.owner, "--credits", "0", "--simulated",
        "--label", p.role,
      ], { stdio: ["ignore", "pipe", "pipe"] }).toString();
    } catch (err) {
      const msg = (err.stdout?.toString() || "") + (err.stderr?.toString() || "");
      console.error(C.red(`  ${p.caller_id}: ${msg.trim().split("\n").pop()}`));
      continue;
    }
    const key = out.match(/elk_[A-Za-z0-9_-]+/)?.[0];
    if (!key) { console.error(C.red(`  ${p.caller_id}: no key in output`)); continue; }
    keys[p.caller_id] = key;
    // Zero credits, deliberately: a simulated stranger searches and calls tools,
    // which are free, and must never be able to publish into the real registry.
    console.log(`  ${C.green("minted")} ${p.caller_id.padEnd(12)} ${C.dim(p.role)}`);
  }
  writeFileSync(KEYS_PATH, JSON.stringify(keys, null, 2));
  console.log(`\n  ${Object.keys(keys).length} keys written to sim/.keys-${SET}.json ${C.dim("(gitignored)")}\n`);
}

// ---------------------------------------------------------------- replay
function mcpUrl() {
  const out = aws(["lambda", "get-function-url-config", "--function-name", `${PREFIX}-mcp`]);
  return JSON.parse(out).FunctionUrl;
}

async function ask(url, key, text) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "endless_search", arguments: { query: text, k: 5 } },
    }),
  });
  const body = await res.json();
  const block = body?.result?.content?.[0]?.text;
  if (body?.result?.isError) return { error: block };
  try { return JSON.parse(block); } catch { return { error: block ?? "unparseable" }; }
}

async function replay() {
  if (!existsSync(KEYS_PATH)) {
    console.error(C.red(`no sim/.keys-${SET}.json — run: node sim/run.mjs --set=${SET} --mint`));
    process.exit(1);
  }
  const keys = JSON.parse(readFileSync(KEYS_PATH, "utf8"));
  const url = mcpUrl();
  console.log(`\n  replaying through ${C.dim(url)}\n`);

  const log = [];
  for (const p of personas) {
    const key = keys[p.caller_id];
    if (!key) { console.error(C.red(`  no key for ${p.caller_id}`)); continue; }
    for (const r of p.requests) {
      const res = await ask(url, key, r.text);
      const found = res.results?.[0]?.tool_id ?? null;
      const gap = res.gap_logged === true;
      log.push({ caller_id: p.caller_id, owner: p.owner, day: r.day, text: r.text, gap, found });
      const mark = res.error ? C.red("ERR") : gap ? C.yellow("gap") : C.green(" ok");
      console.log(`  ${mark}  ${p.caller_id.padEnd(12)} ${C.dim(r.text.slice(0, 52))}` +
                  `${res.error ? C.red(`  ${String(res.error).slice(0, 40)}`) : found ? C.dim(`  -> ${found}`) : ""}`);
    }
  }

  writeFileSync(join(HERE, "run-log.json"), JSON.stringify({
    ran_at: new Date().toISOString(), personas_sha256: sha, requests: log,
  }, null, 2));

  const gaps = log.filter((l) => l.gap).length;
  console.log(`\n  ${log.length} requests, ${gaps} logged as gaps, ${log.length - gaps} matched a tool\n`);

  // Spread the timestamps so the corroboration rules have something to read.
  //
  // The whole set is replayed in one minute, and a cluster asked for entirely
  // within one minute is correctly refused for lack of spread. Backdating to
  // the days written in personas.json is what makes the replay a stand-in for
  // eleven days of traffic rather than a burst.
  backdate(log);
}

// ts is the gaps sort key, so this is delete-then-put rather than an update.
function backdate(log) {
  const items = JSON.parse(aws(["dynamodb", "scan", "--table-name", `${PREFIX}-gaps`])).Items ?? [];
  const sim = items.filter((i) => i.simulated?.BOOL === true);
  const byText = new Map(log.map((l) => [l.text, l]));
  let moved = 0;

  for (const item of sim) {
    const entry = byText.get(item.query?.S);
    if (!entry) continue;
    const ts = new Date(Date.now() - entry.day * 86400000).toISOString();
    if (item.ts.S === ts) continue;
    aws(["dynamodb", "delete-item", "--table-name", `${PREFIX}-gaps`,
         "--key", JSON.stringify({ gap_id: item.gap_id, ts: item.ts })]);
    aws(["dynamodb", "put-item", "--table-name", `${PREFIX}-gaps`,
         "--item", JSON.stringify({
           ...item, ts: { S: ts }, day: { S: ts.slice(0, 10) },
           // Callers that existed before the traffic they produced. A caller
           // created after its own cluster is the manufactured shape, and the
           // simulation should not trip its own flag by accident of replay.
           caller_created_at: { S: new Date(Date.now() - 180 * 86400000).toISOString() },
         })]);
    moved++;
  }
  console.log(`  ${moved} gap rows spread across the days written in the set\n`);
}

// ---------------------------------------------------------------- purge
function purge() {
  const gaps = JSON.parse(aws(["dynamodb", "scan", "--table-name", `${PREFIX}-gaps`])).Items ?? [];
  let g = 0;
  for (const item of gaps.filter((i) => i.simulated?.BOOL === true)) {
    aws(["dynamodb", "delete-item", "--table-name", `${PREFIX}-gaps`,
         "--key", JSON.stringify({ gap_id: item.gap_id, ts: item.ts })]);
    g++;
  }

  const events = JSON.parse(aws(["dynamodb", "scan", "--table-name", `${PREFIX}-events`])).Items ?? [];
  let e = 0;
  for (const item of events.filter((i) => i.simulated?.BOOL === true)) {
    aws(["dynamodb", "delete-item", "--table-name", `${PREFIX}-events`,
         "--key", JSON.stringify({ event_id: item.event_id, ts: item.ts })]);
    e++;
  }

  let c = 0;
  for (const p of personas) {
    try {
      aws(["dynamodb", "delete-item", "--table-name", `${PREFIX}-callers`,
           "--key", JSON.stringify({ caller_id: { S: p.caller_id } })]);
      c++;
    } catch { /* already gone */ }
  }
  console.log(`\n  purged ${g} gaps, ${e} events, ${c} callers\n`);
}

// ---------------------------------------------------------------- dispatch
// Flags rather than a single positional, so --set= can sit anywhere. The first
// version read process.argv[2] and `--set=builder --help` ran the whole replay.
const argv = process.argv.slice(2);
if (argv.includes("--mint")) mint();
else if (argv.includes("--purge")) purge();
else if (argv.includes("--help")) {
  console.log(`
  ${C.bold("sim/run.mjs")} — replay twelve simulated strangers

    --mint     create the simulated callers (once)
    (none)     replay the blind set through the live MCP endpoint
    --purge    delete every simulated gap, event and caller

  ${C.dim(`set ${sha.slice(0, 16)}… · ${personas.length} personas · ${personas.reduce((n, p) => n + p.requests.length, 0)} requests`)}
`);
} else await replay();
