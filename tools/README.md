# Seed tools — issue #10

19 tools wrapping free, no-auth public APIs. All verified live.

```
node tools/verify.mjs                    # call every tool, check its probe resolves
node tools/call.mjs weather-forecast     # call one with its sample input
node tools/call.mjs geocode-address '{"query":"Kumasi"}'
```

## These are real wrappers, not metadata

Phase 0 never executes a registered tool, so none of this runs in the search
path. It was written anyway, because writing a working wrapper is what forces a
description to come from a real response instead of a guess about one — and
description quality is the ceiling on every number this phase produces.

The cost of skipping it is invisible: vaguer descriptions depress recall for
reasons that have nothing to do with retrieval, and the phase then measures the
author rather than the mechanism.

## How the set was chosen

By what a general agent toolkit would plausibly wrap: well-known, free, no-auth
APIs spread across unrelated domains — geo, finance, reference, calendar,
research, software, statistics, media, network, science, health.

**Not** by reading `eval/queries.json`. Picking tools to match the frozen
queries would contaminate the measurement from the other direction, which is
the mirror image of the mistake the blind-query rule exists to prevent. Whether
any given query turns out answerable is therefore an outcome, discovered in #11.

## Two APIs were dropped

| API | Why |
|---|---|
| `dictionaryapi.dev` | connection failure, no response at all |
| `restcountries.com` | **HTTP 200 with an error body** — deprecated on v3.1 and v5 alike |

The second is the instructive one. A status code is not proof an API works, so
`callTool` checks the response shape for `{success:false}` as well as the code,
and `verify.mjs` requires the documented probe path to actually resolve.

## Effect on the contamination note

Three ids — `weather-forecast`, `currency-convert`, `wikipedia-summary` —
already existed as runbook fixtures whose descriptions had been read before the
eval queries were written. Re-registering them produced `@0003`, `@0002` and
`@0002`, and search resolves to the latest version.

**The exact wording that was seen is therefore no longer in the scored corpus.**
The older versions remain in the registry as history, which is the immutable
versioning invariant doing something useful rather than ceremonial.

What this does *not* fix is topic selection: the decision to write weather, FX
and reference-lookup queries was still made after seeing those domains. The nine
affected queries stay flagged in `eval/README.md`, and #11 must still report
recall with and without them.

## Observations from a four-query smoke test

Not tuning data. Recorded because they bear on #12, and deliberately not acted
on — fitting a threshold to four observations is the exact failure the plan
warns about.

| Query | Top result | Score |
|---|---|---|
| peer reviewed papers on RAG | `crossref-paper-search` | 0.2647 |
| licence of this open source package | `github-repo-info` | 0.2656 |
| temperature tomorrow afternoon | `weather-forecast` | 0.0871 |
| book me a haircut | `current-time-in-zone` (nonsense) | 0.0665 |

Two things follow. Correct hits span a wide band — 0.087 to 0.266 — so a single
global threshold is doing very different work at different points in it. And the
weakest correct hit (0.0871) sits uncomfortably close to the strongest spurious
one (0.0665), which is the overlap the deck predicted would decide whether
cosine distance alone can separate a gap from a miss.

`T = 0.05` did not log the haircut query as a gap. That is a real miss and it
stays uncorrected until #12 derives `T` from the full distribution.

## Terms

Every entry records `source_api` and a `terms` link. These are free public
services with rate limits and acceptable-use policies; requests send a
descriptive `user-agent` identifying the project.

## Known gap

`mcp_url` currently points at `repo:tools/catalog.json#<tool_id>` — a provenance
pointer, not a reachable MCP endpoint. `CLAUDE.md` defines a tool as "exposed as
an MCP server", and no MCP server exists yet.

That is honest for Phase 0, which never executes anything, but it is a real
shortfall against the definition and it becomes blocking in Phase 1, where
sandboxed execution needs genuine endpoints.
