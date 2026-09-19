import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  mintKey, parseKey, hashKey, keyMatches, bearerFrom, authorise, isSelfCall,
} from "../lambda/exec/auth.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// exec-fn and search-fn ship as separate zips and cannot share an import, so
// auth.mjs is duplicated. This is what stops the two copies drifting.
test("the two copies of auth.mjs are byte identical", () => {
  const a = readFileSync(join(HERE, "../lambda/exec/auth.mjs"));
  const b = readFileSync(join(HERE, "../lambda/search/auth.mjs"));
  assert.ok(a.equals(b), "exec/auth.mjs and search/auth.mjs have diverged");
});

test("a minted key round-trips and verifies", () => {
  const { key, caller_id, key_hash } = mintKey("acme-bot");
  assert.equal(parseKey(key).caller_id, "acme-bot");
  assert.equal(caller_id, "acme-bot");
  assert.ok(keyMatches(key, key_hash));
});

test("the secret is never recoverable from what is stored", () => {
  const { key, key_hash } = mintKey("acme-bot");
  assert.equal(key_hash.length, 64);
  assert.ok(!key_hash.includes(key.split("_")[2]), "stored hash must not contain the secret");
  assert.equal(key_hash, hashKey(key));
});

test("two keys for the same caller differ", () => {
  assert.notEqual(mintKey("acme-bot").key, mintKey("acme-bot").key);
});

test("a wrong key does not verify", () => {
  const { key_hash } = mintKey("acme-bot");
  assert.equal(keyMatches("elk_acme-bot_wrongsecret", key_hash), false);
});

// Claiming someone else's caller id does not help: the id selects which stored
// hash to compare against, and the secret still has to match it.
test("substituting the caller id does not grant access", () => {
  const victim = mintKey("victim");
  const attacker = mintKey("attacker");
  const forged = `elk_victim_${attacker.key.split("_")[2]}`;
  assert.equal(keyMatches(forged, victim.key_hash), false);
});

test("malformed keys are rejected before any lookup", () => {
  for (const bad of ["", "bearer", "elk_", "elk__secret", "wrong_acme_secret",
                     "elk_ACME_secret", "elk_-bad_secret", null, undefined, 42]) {
    assert.equal(parseKey(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

// The caller id ends at the FIRST underscore after the prefix, and everything
// after it is secret. Unambiguous because the caller id charset excludes "_",
// which is also why the secret may contain as many as base64url gives it.
test("the caller id boundary is the first underscore, not the last", () => {
  assert.deepEqual(parseKey("elk_acme_bot_secret"), { caller_id: "acme", secret: "bot_secret" });
  assert.deepEqual(parseKey("elk_acme-bot_a_b_c"), { caller_id: "acme-bot", secret: "a_b_c" });
});

test("a malformed stored hash never matches", () => {
  const { key } = mintKey("acme-bot");
  for (const bad of ["", "short", null, undefined, "z".repeat(64)]) {
    assert.equal(keyMatches(key, bad), false);
  }
});

test("bearer header is read case-insensitively", () => {
  assert.equal(bearerFrom({ authorization: "Bearer abc" }), "abc");
  assert.equal(bearerFrom({ Authorization: "bearer abc" }), "abc");
  assert.equal(bearerFrom({ authorization: "Basic abc" }), null);
  assert.equal(bearerFrom({}), null);
});

test("authorise refuses unknown, suspended and broke callers", () => {
  assert.equal(authorise(null, 1).status, 401);
  assert.equal(authorise({ status: "suspended", credits: 100 }, 1).status, 403);
  // 402, not 403: a billing state a caller can act on, not a permissions one.
  assert.equal(authorise({ status: "active", credits: 0 }, 1).status, 402);
  assert.equal(authorise({ status: "active", credits: 1 }, 1).ok, true);
});

test("a caller with exactly enough credits is allowed", () => {
  assert.equal(authorise({ status: "active", credits: 5 }, 5).ok, true);
  assert.equal(authorise({ status: "active", credits: 4 }, 5).ok, false);
});

// The wash-trading guard. Charging for calls makes fake demand expensive, but it
// also makes usage purchasable — and mass is computed from usage.
test("a call by the tool's own owner is flagged as a self call", () => {
  assert.equal(isSelfCall({ owner: "erics" }, { owner: "erics" }), true);
  assert.equal(isSelfCall({ owner: "erics" }, { owner: "someone-else" }), false);
});

test("a missing owner on either side is not treated as a self call", () => {
  assert.equal(isSelfCall({}, { owner: "erics" }), false);
  assert.equal(isSelfCall({ owner: "erics" }, {}), false);
  assert.equal(isSelfCall(null, null), false);
});
