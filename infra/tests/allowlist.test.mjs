// Phase 1, issue #5 — the half of the escape tests that needs no AWS.
//
// Each of these is an attack, not a unit. If one starts failing, the sandbox has
// a hole, so they are written to be read by someone deciding whether to trust it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderUrl, checkUrl, prepare, checkMethod } from "../lambda/fetcher/allowlist.mjs";

const ALLOW = ["api.allowed.com"];

test("a plain declared url passes", () => {
  const v = checkUrl("https://api.allowed.com/v1/thing?q=1", ALLOW);
  assert.equal(v.ok, true);
  assert.equal(v.host, "api.allowed.com");
});

test("an unlisted host is refused", () => {
  assert.equal(checkUrl("https://api.evil.com/x", ALLOW).ok, false);
});

// The classic near-miss. Suffix matching would admit both of these, which is
// why the check is exact equality on host.
test("lookalike hosts are refused", () => {
  for (const u of [
    "https://evil-api.allowed.com.evil.net/x",
    "https://notapi.allowed.com/x",
    "https://api.allowed.com.evil.net/x",
    "https://apiXallowed.com/x",
  ]) {
    assert.equal(checkUrl(u, ALLOW).ok, false, `should refuse ${u}`);
  }
});

// https://api.allowed.com@evil.com/ has host evil.com. A human skims past it.
test("credentials in the url are refused", () => {
  const v = checkUrl("https://api.allowed.com@evil.com/x", ALLOW);
  assert.equal(v.ok, false);
  assert.match(v.reason, /credentials/);
});

test("non-https schemes are refused", () => {
  for (const u of ["http://api.allowed.com/x", "file:///etc/passwd", "ftp://api.allowed.com/x"]) {
    assert.equal(checkUrl(u, ALLOW).ok, false, `should refuse ${u}`);
  }
});

// The important one: inputs are encoded, so a value cannot rewrite the path or
// query of a URL the manifest already declared.
test("a hostile input cannot rewrite the path or query", () => {
  const tpl = "https://api.allowed.com/v1/lookup?q={q}";
  const url = renderUrl(tpl, { q: "../../admin?x=1#frag&key=leak" });
  assert.ok(url.startsWith("https://api.allowed.com/v1/lookup?q="), url);
  assert.ok(!url.includes("#"), "fragment must be encoded");
  assert.ok(!url.includes("../"), "path traversal must be encoded");
  assert.equal(checkUrl(url, ALLOW).ok, true);
});

test("a hostile input cannot change the host", () => {
  const url = renderUrl("https://api.allowed.com/{path}", { path: "x@evil.com/y" });
  assert.equal(new URL(url).host, "api.allowed.com");
});

test("a missing input is refused rather than rendered empty", () => {
  assert.throws(() => renderUrl("https://api.allowed.com/{id}", {}), /missing input: id/);
});

test("prepare renders THEN checks, so the check sees the real url", () => {
  assert.throws(
    () => prepare({ id: "r", url: "https://{host}/x" }, { host: "evil.com" }, ALLOW),
    /not in the allowlist/,
  );
});

test("only GET is permitted in Phase 1", () => {
  assert.equal(checkMethod("GET").ok, true);
  for (const m of ["POST", "PUT", "DELETE", "PATCH"]) {
    assert.equal(checkMethod(m).ok, false, `${m} should be refused`);
  }
});

test("an empty allowlist admits nothing", () => {
  assert.equal(checkUrl("https://api.allowed.com/x", []).ok, false);
});
