#!/usr/bin/env node
// stasis — sell a creator the right to keep their star shining.
//
//   node cli/stasis.mjs                          who is paying, and for what
//   node cli/stasis.mjs <tool_id> --on           hold the stage it has now
//   node cli/stasis.mjs <tool_id> --on --stage star
//   node cli/stasis.mjs <tool_id> --off
//
// WHAT IT BUYS. Visibility to people looking at the 3D world, after usage drops.
// A creator who publishes a tool or an app and wants others to seek it out
// specifically can keep their body lit rather than watching it fade.
//
// WHAT IT DOES NOT BUY. Anything in the phantom layer. It does not change what
// search returns, what an agent is offered, what outranks what, or whether an
// archived tool becomes discoverable again. An archived tool with stasis keeps
// a star in the sky and stays out of every result an agent ever sees.
//
// WHERE IT LIVES, AND WHY NOT IN DYNAMODB.
//
// In one small S3 object that only the nightly job reads, alongside the world
// snapshot it feeds. Not in the tools table, and not on the tool row.
//
// That is structural rather than tidy. Everything on the agent path reads
// DynamoDB; nothing on the agent path reads this object. So a paid field
// cannot reach a ranking by somebody forgetting it is there — it is not in any
// table a ranking is computed from. The invariant stops depending on care.
//
// It also keeps the free-tier DynamoDB budget, which is at 23 of 25, for things
// that are actually on a hot path. Commercial state that changes when somebody
// buys something does not need provisioned capacity.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REGION = process.env.AWS_REGION || "us-east-1";
const PREFIX = process.env.ENDLESS_PREFIX || "endless-p0";
const OPERATOR = process.env.ENDLESS_REVIEWER || process.env.USERNAME || process.env.USER || "operator";
// Kept in step with world.mjs, which is the only thing that renders them.
const STAGES = ["dark", "planet", "star"];
const STAR_THRESHOLD = 20;

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

function aws(args) {
  try {
    return execFileSync("aws", [...args, "--region", REGION],
      { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 }).toString();
  } catch (err) {
    const msg = (err.stderr?.toString() || err.message).trim().split("\n").pop();
    console.error(C.red(`  aws call failed: ${msg}`));
    process.exit(1);
  }
}

const bucket = `${PREFIX}-board-${JSON.parse(aws(["sts", "get-caller-identity"])).Account}`;
const KEY = "stasis.json";
const local = join(tmpdir(), `stasis-${Date.now()}.json`);

function load() {
  try {
    execFileSync("aws", ["s3", "cp", `s3://${bucket}/${KEY}`, local, "--region", REGION], { stdio: "pipe" });
    return JSON.parse(readFileSync(local, "utf8"));
  } catch {
    // No object yet is not an error; nobody has bought anything.
    return { version: 1, tools: {} };
  }
}

function save(doc) {
  writeFileSync(local, JSON.stringify(doc, null, 2));
  aws(["s3", "cp", local, `s3://${bucket}/${KEY}`, "--content-type", "application/json"]);
}

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n) => { const i = args.indexOf(`--${n}`); return i === -1 ? null : args[i + 1]; };
const toolId = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

const doc = load();

// ---------------------------------------------------------------- list
if (!toolId) {
  const held = Object.entries(doc.tools ?? {}).filter(([, v]) => v.active);
  console.log(`\n  ${C.bold(`${held.length} paying`)}   ${C.dim(`s3://${bucket}/${KEY}`)}\n`);
  for (const [id, v] of held) {
    console.log(`  ${C.green("held")}  ${id.padEnd(24)} ${C.dim(`stage ${v.frozen_stage} · since ${v.since} · sold by ${v.sold_by}`)}`);
  }
  if (!held.length) console.log(C.dim("  nobody is paying to hold a star.\n"));
  console.log(`\n  ${C.dim("Stasis is advertising in the 3D world. It changes nothing an agent sees.")}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------- off
if (flag("off")) {
  if (!doc.tools?.[toolId]?.active) {
    console.error(C.red(`  ${toolId} is not being held`));
    process.exit(1);
  }
  doc.tools[toolId] = { ...doc.tools[toolId], active: false, ended: new Date().toISOString() };
  save(doc);
  console.log(`\n  ${C.yellow("released")}  ${C.bold(toolId)}`);
  console.log(`  ${C.dim("its body returns to the stage its usage has earned on the next nightly run")}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------- on
if (!flag("on")) {
  console.error("  usage: node cli/stasis.mjs <tool_id> --on [--stage star] | --off");
  process.exit(1);
}

// Read from the agent-facing numbers, never typed in. Stasis holds a stage a
// tool REACHED; an operator who could name any stage would be handing one over,
// and the rule would live in whoever was at the keyboard rather than in code.
let earned;
try {
  const out = join(tmpdir(), `tools-${Date.now()}.json`);
  execFileSync("aws", ["s3", "cp", `s3://${bucket}/tools.json`, out, "--region", REGION], { stdio: "pipe" });
  const row = JSON.parse(readFileSync(out, "utf8")).tools.find((t) => t.tool_id === toolId);
  if (!row) { console.error(C.red(`  ${toolId} is not in the registry`)); process.exit(1); }
  earned = row.archived ? "dark" : (row.live_mass >= STAR_THRESHOLD ? "star" : "planet");
  console.log(C.dim(`  stage read from tools.json: ${earned} (live mass ${row.live_mass})`));
} catch (err) {
  console.error(C.red("  could not read tools.json, so there is no stage to hold"));
  process.exit(1);
}

const stage = value("stage") ?? earned;
if (!STAGES.includes(stage)) {
  console.error(C.red(`  stage must be one of: ${STAGES.join(", ")}`));
  process.exit(1);
}
if (STAGES.indexOf(stage) > STAGES.indexOf(earned)) {
  // The hole this closes: --stage star on a planet would have sold a promotion
  // rather than a hold, and worldStage would have rendered it.
  console.error(C.red(`  ${toolId} has earned ${earned}, so ${stage} cannot be held`));
  console.error(C.dim("  stasis keeps a stage a tool reached. It never grants one."));
  process.exit(1);
}
if (stage === "dark") {
  // Holding "dark" is buying nothing, and selling it would be selling nothing.
  console.error(C.red(`  ${toolId} is archived — there is no light to hold`));
  process.exit(1);
}

doc.tools = doc.tools ?? {};
doc.tools[toolId] = {
  active: true,
  frozen_stage: stage,
  owner: value("owner") ?? doc.tools[toolId]?.owner ?? null,
  since: new Date().toISOString(),
  sold_by: OPERATOR,
};
save(doc);

console.log(`\n  ${C.green("held")}  ${C.bold(toolId)} at ${C.bold(stage)}`);
console.log(`  ${C.dim("visible in the 3D world after usage drops, and labelled as sponsored when it is")}`);
console.log(`  ${C.dim("nothing an agent sees has changed: not search, not ranking, not discovery")}\n`);
