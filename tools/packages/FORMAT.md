# Tool package format

**Phase 1, issue #2.** What a creator submits, and the contract the sandbox enforces.

```
tools/packages/<tool_id>/
  manifest.json    what it is, what it may reach, how it is invoked
  handler.mjs      a pure transform — no imports, no network, no disk
  test.mjs         fixtures proving it works with no network at all
```

## The contract

**A tool never opens a network connection.** It declares the requests it needs in
`manifest.json`; the platform fetches them against that tool's allowlist and hands
the responses to `transform()`. The tool turns data into data.

That is what makes the sandbox arguable rather than hopeful. With no network, no IAM
role and no writable disk, escaping the sandbox reaches an empty room — there is no
credential to take and nowhere to send it.

## manifest.json

```jsonc
{
  "tool_id": "air-quality",
  "name": "Air Quality Now",
  "description": "...",           // for RETRIEVAL. See the rule below.
  "category": "health",
  "runtime": "lambda-vpc",        // see docs/phase-1-runtime-policy.md
  "runtime_reason": "...",
  "source_api": "open-meteo.com",
  "terms": "https://...",
  "input": {                       // validated before anything is fetched
    "lat": { "type": "number", "required": true },
    "lon": { "type": "number", "required": true }
  },
  "allowlist": ["air-quality-api.open-meteo.com"],
  "requests": [
    { "id": "aq", "method": "GET", "url": "https://air-quality-api.open-meteo.com/v1/air-quality?latitude={lat}&..." }
  ],
  "sample": { "lat": 5.6, "lon": -0.19 }
}
```

**Every host in every `requests[].url` must appear in `allowlist`.** The fetcher
checks this at call time, not only at review — a template that renders to an
unlisted host is refused.

**`{placeholders}` may only name keys declared in `input`.** No placeholder can
introduce a host, a scheme or a path segment that was not written in the manifest,
so a crafted input cannot redirect the fetch.

## handler.mjs

```js
export function transform({ input, responses }) {
  const aq = responses.aq.body;     // already parsed
  return { /* plain JSON */ };
}
```

One export. No imports — not even from elsewhere in the package. The runtime passes
everything in and takes the return value out.

A thrown error is a failed call and is recorded as such in the event log. Returning
something unserialisable is the same as throwing.

## Writing the description

This is the highest-leverage field in the package, and the counter-intuitive part is
measured, not stylistic.

**Say what the tool does, concretely, and never what it does not do.**

Phase 0 tried adding boundary clauses — "not air quality", "not fiat currency" — to
disambiguate neighbouring tools. Recall@1 fell from 90.9% to 81.8%. Embeddings carry
no representation of negation, so writing that a tool *"does not look up the owner or
country of another address"* raised its score on exactly that query by 0.1331. The
words land; the "not" does not.

Positive, concrete descriptions took recall@1 to 100%. Differentiate by being
specific about your own capability, never by naming the neighbour you are trying to
be distinguished from.

## test.mjs

Fixtures, run with `node --test`. The point is that a tool is testable **with no
network**: you supply the `responses` the platform would have fetched, and assert on
what `transform` returns. If a tool cannot be tested this way, it is reaching for
something it should have declared.

## Review checklist

- [ ] every host in `requests` appears in `allowlist`
- [ ] every `{placeholder}` is a declared `input` key
- [ ] `runtime` matches the policy, and `runtime_reason` cites a real trigger
- [ ] description states capability positively and names no neighbouring tool
- [ ] `handler.mjs` has no imports and no side effects
- [ ] `test.mjs` passes offline
- [ ] `source_api` and `terms` are filled in and the terms permit this use
