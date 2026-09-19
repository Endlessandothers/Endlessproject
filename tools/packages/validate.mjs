// Validates a tool package against the contract in FORMAT.md.
//
// This is the mechanical half of the Phase 1 review gate. A human still judges
// whether a tool is worth having; this judges whether it is safe and well-formed,
// and it does so identically every time.
//
//   node tools/packages/validate.mjs                 all packages
//   node tools/packages/validate.mjs air-quality     one
//   node tools/packages/validate.mjs --live          also call the declared URLs

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIMES = ["lambda-vpc", "fargate"];

// Negation is measured, not stylistic: boundary clauses took Phase 0 recall@1
// from 90.9% to 81.8%, because embeddings represent the words and not the "not".
const NEGATION = /\b(not|never|unlike|rather than|instead of|does not|doesn't|cannot|isn't|excludes?)\b/i;

function checkPackage(dir, { live = false } = {}) {
  const errs = [], warns = [];
  const base = join(HERE, dir);
  const mPath = join(base, "manifest.json");

  if (!existsSync(mPath)) return { dir, errs: ["no manifest.json"], warns };
  let m;
  try { m = JSON.parse(readFileSync(mPath, "utf8")); }
  catch (e) { return { dir, errs: [`manifest.json is not valid JSON: ${e.message}`], warns }; }

  for (const f of ["tool_id", "name", "description", "category", "runtime", "source_api", "terms"]) {
    if (!m[f]) errs.push(`missing field: ${f}`);
  }
  if (m.tool_id && m.tool_id !== dir) errs.push(`tool_id "${m.tool_id}" does not match directory "${dir}"`);

  if (m.runtime && !RUNTIMES.includes(m.runtime)) {
    errs.push(`runtime must be one of ${RUNTIMES.join(", ")}`);
  }
  if (m.runtime === "fargate" && !m.runtime_reason) {
    errs.push("fargate requires runtime_reason citing a policy trigger");
  }

  // Description quality — a warning, because a legitimate sentence can contain
  // "not" and a false positive should not block a creator.
  if (m.description && NEGATION.test(m.description)) {
    warns.push(`description contains negation — "${m.description.match(NEGATION)[0]}". `
      + "Say what the tool does, never what it does not. See FORMAT.md.");
  }
  if (m.description && m.description.length < 40) warns.push("description is very short; retrieval quality is the ceiling on every later number");

  const allow = new Set(m.allowlist || []);
  const inputs = new Set(Object.keys(m.input || {}));

  for (const req of m.requests || []) {
    if (!req.id) errs.push("a request has no id");
    if (!req.url) { errs.push(`request ${req.id}: no url`); continue; }

    // Every placeholder must be a declared input. This is what stops a crafted
    // input introducing a host, scheme or path the manifest never named.
    for (const ph of [...req.url.matchAll(/\{(\w+)\}/g)].map((x) => x[1])) {
      if (!inputs.has(ph)) errs.push(`request ${req.id}: {${ph}} is not a declared input`);
    }

    let host;
    try { host = new URL(req.url.replace(/\{\w+\}/g, "x")).host; }
    catch { errs.push(`request ${req.id}: url is not parseable`); continue; }

    if (!allow.has(host)) errs.push(`request ${req.id}: host ${host} is not in allowlist`);
    if (!req.url.startsWith("https://")) errs.push(`request ${req.id}: must be https`);
  }
  for (const h of allow) {
    if (!(m.requests || []).some((r) => r.url?.includes(h))) warns.push(`allowlist entry ${h} is unused`);
  }

  // The handler must be a pure transform. An import is the seam through which
  // everything the sandbox forbids would arrive.
  const hPath = join(base, "handler.mjs");
  if (!existsSync(hPath)) errs.push("no handler.mjs");
  else {
    const src = readFileSync(hPath, "utf8");
    if (/^\s*import\s/m.test(src)) errs.push("handler.mjs must not import anything");
    if (/\brequire\s*\(/.test(src)) errs.push("handler.mjs must not use require()");
    if (/\bfetch\s*\(|XMLHttpRequest|node:|process\.env/.test(src)) {
      errs.push("handler.mjs reaches for the network, node internals or the environment");
    }
    if (!/export\s+function\s+transform/.test(src)) errs.push("handler.mjs must export function transform");
  }

  if (!existsSync(join(base, "test.mjs"))) warns.push("no test.mjs — a tool should be testable offline");

  return { dir, manifest: m, errs, warns };
}

async function live(m) {
  const out = [];
  for (const req of m.requests || []) {
    const url = req.url.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(m.sample?.[k] ?? ""));
    try {
      const t0 = Date.now();
      const res = await fetch(url, { headers: { "user-agent": "Endless-Phase1/0.1" } });
      out.push(`      ${res.ok ? "ok  " : "FAIL"} ${req.id}: HTTP ${res.status} in ${Date.now() - t0}ms`);
    } catch (e) {
      out.push(`      FAIL ${req.id}: ${e.message.slice(0, 60)}`);
    }
  }
  return out;
}

const args = process.argv.slice(2);
const wantLive = args.includes("--live");
const only = args.filter((a) => !a.startsWith("--"));
const dirs = (only.length ? only : readdirSync(HERE, { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name));

let failed = 0;
for (const dir of dirs) {
  const r = checkPackage(dir, { live: wantLive });
  const status = r.errs.length ? "REJECT" : (r.warns.length ? "PASS*" : "PASS ");
  console.log(`\n  ${status} ${dir}${r.manifest ? `  (${r.manifest.runtime})` : ""}`);
  for (const e of r.errs) console.log(`      error: ${e}`);
  for (const w of r.warns) console.log(`      warn : ${w}`);
  if (wantLive && r.manifest && !r.errs.length) {
    for (const line of await live(r.manifest)) console.log(line);
  }
  if (r.errs.length) failed++;
}
console.log(`\n  ${dirs.length - failed}/${dirs.length} packages accepted\n`);
process.exit(failed ? 1 : 0);
