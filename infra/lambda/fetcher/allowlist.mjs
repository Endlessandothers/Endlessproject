// URL construction and allowlist enforcement — pure, so it is testable without
// credentials and without making a single request.
//
// This is the only place in Endless where a tool's declared intent becomes a
// real outbound connection, so the checks here are the difference between a
// sandbox and a story about one.

export function renderUrl(template, input) {
  const missing = [];
  const url = template.replace(/\{(\w+)\}/g, (_, key) => {
    if (!(key in (input ?? {}))) { missing.push(key); return ""; }
    // Encoded, always. Without this, an input containing "?" or "#" or "/"
    // rewrites the path and query of a URL the manifest already declared.
    return encodeURIComponent(String(input[key]));
  });
  if (missing.length) throw new Error(`missing input: ${missing.join(", ")}`);
  return url;
}

export function checkUrl(url, allowlist) {
  let parsed;
  try { parsed = new URL(url); }
  catch { return { ok: false, reason: "url is not parseable" }; }

  if (parsed.protocol !== "https:") {
    return { ok: false, reason: `scheme ${parsed.protocol} refused, https only` };
  }
  // Credentials in a URL are a redirection trick as often as a convenience:
  // https://allowed.com@evil.com/ has host evil.com, and a reader skims past it.
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "credentials in url are refused" };
  }
  // Exact host match. No suffix matching: "allowed.com" must not admit
  // "evil-allowed.com" or "allowed.com.evil.net".
  if (!allowlist.includes(parsed.host)) {
    return { ok: false, reason: `host ${parsed.host} is not in the allowlist` };
  }
  return { ok: true, host: parsed.host };
}

// Rendered, then checked. Doing it in this order is the point: the check must
// see the URL that will actually be requested, not the template it came from.
export function prepare(request, input, allowlist) {
  const url = renderUrl(request.url, input);
  const verdict = checkUrl(url, allowlist);
  if (!verdict.ok) throw new Error(`${request.id}: ${verdict.reason}`);
  return { id: request.id, method: (request.method || "GET").toUpperCase(), url };
}

export const ALLOWED_METHODS = ["GET"];

export function checkMethod(method) {
  return ALLOWED_METHODS.includes(method)
    ? { ok: true }
    : { ok: false, reason: `method ${method} refused; Phase 1 tools are read-only` };
}
