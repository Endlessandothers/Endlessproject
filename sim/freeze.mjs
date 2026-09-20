#!/usr/bin/env node
// Stamp the checksum of the blind set. Run once, before the first replay.
//
// A set that can be edited after seeing the results is not a blind set, so
// run.mjs and analyse.mjs both refuse to report anything if the file has moved
// since this was written. Same guard as the Phase 0 harness.
import { readFileSync, writeFileSync } from "node:fs";
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
const raw = readFileSync(join(HERE, SET_FILE), "utf8").replace(/\r\n/g, "\n");
const sha = createHash("sha256").update(raw, "utf8").digest("hex");
writeFileSync(join(HERE, SET_SHA), `${sha}  personas.json\n`);

// truth.json records which set it was written against, so a label file cannot
// silently be paired with a different set of requests.
const tp = join(HERE, TRUTH_FILE);
const truth = JSON.parse(readFileSync(tp, "utf8"));
truth.personas_sha256 = sha;
writeFileSync(tp, `${JSON.stringify(truth, null, 2)}\n`);

console.log(`frozen: ${sha}`);
