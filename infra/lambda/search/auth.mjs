// Caller identity and metering — Phase 1, issue #1.
//
// Pure functions: no AWS imports, so the key format and the verification rules
// are testable without credentials and without a table.
//
// DUPLICATED, DELIBERATELY. An identical copy lives in ../search/auth.mjs
// because exec-fn and search-fn ship as separate zips and cannot import across
// package boundaries. infra/tests/auth.test.mjs asserts the two files are byte
// identical, so they cannot drift apart unnoticed.
//
// KEY FORMAT
//
//   elk_<caller_id>_<secret>
//
// The caller id is IN the key. That means verification is a single GetItem on
// the primary key rather than a lookup by hash, so no secondary index is needed
// and the free-tier capacity budget is untouched. The secret is never stored —
// only its SHA-256 — so a dump of the callers table does not yield working keys.

import { createHash, timingSafeEqual, randomBytes } from "node:crypto";

export const KEY_PREFIX = "elk";

export function mintKey(callerId) {
  if (!/^[a-z0-9][a-z0-9-]{1,38}$/.test(callerId)) {
    throw new Error("caller_id must be 2-39 chars of lowercase letters, digits and hyphens");
  }
  const secret = randomBytes(24).toString("base64url");
  const key = `${KEY_PREFIX}_${callerId}_${secret}`;
  return { key, caller_id: callerId, key_hash: hashKey(key) };
}

export const hashKey = (key) => createHash("sha256").update(key, "utf8").digest("hex");

// Parsed by regex, not by splitting on "_".
//
// The secret is base64url, whose alphabet INCLUDES the underscore, so a split
// produced four or more parts whenever a random secret happened to contain one
// — an intermittent authentication failure that depended on luck. The caller id
// charset excludes "_", so anchoring the pattern makes the boundary unambiguous
// however many underscores the secret carries.
const KEY_RE = new RegExp(`^${KEY_PREFIX}_([a-z0-9][a-z0-9-]{1,38})_(.+)$`);

export function parseKey(key) {
  if (typeof key !== "string") return null;
  const m = key.match(KEY_RE);
  return m ? { caller_id: m[1], secret: m[2] } : null;
}

// Constant time. A plain === on a hash leaks, through timing, how much of a
// guess was correct, which turns a 2^256 search into a per-character one.
export function keyMatches(key, storedHash) {
  if (typeof storedHash !== "string" || storedHash.length !== 64) return false;
  const a = Buffer.from(hashKey(key), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function bearerFrom(headers = {}) {
  // Lambda lowercases header names, but a direct invoke might not.
  const raw = headers.authorization ?? headers.Authorization ?? "";
  const m = String(raw).match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

// What a caller is allowed to do right now, given their record and the cost of
// the call they are attempting.
export function authorise(callerRow, cost) {
  if (!callerRow) return { ok: false, status: 401, error: "unknown key" };
  if (callerRow.status !== "active") {
    return { ok: false, status: 403, error: `caller is ${callerRow.status}` };
  }
  const credits = Number(callerRow.credits ?? 0);
  if (credits < cost) {
    // 402 rather than 403: this is a billing state, not a permissions one, and
    // a caller should be able to tell the difference without reading prose.
    return { ok: false, status: 402, error: `insufficient credits: ${credits} left, ${cost} required` };
  }
  return { ok: true, credits_before: credits };
}

// A call by a tool's own owner is not demand, and must never count toward mass.
//
// This is the flip side of charging for calls. Metering makes fake DEMAND
// expensive, which is the point — but it also makes usage purchasable, and mass
// is computed from usage. Without this flag an owner could simply buy credits
// and call their own tool until it outranks everything.
//
// Flagged at write time rather than inferred later, because the ownership of
// either side can change and the event log has to stay true to the moment.
export function isSelfCall(callerRow, toolRow) {
  const callerOwner = callerRow?.owner ?? null;
  const toolOwner = toolRow?.owner ?? null;
  if (!callerOwner || !toolOwner) return false;
  return callerOwner === toolOwner;
}
