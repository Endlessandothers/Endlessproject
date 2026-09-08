# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

Endless is a self-expanding ecosystem of tools that AI agents discover and call.
Agents generate tools to fill gaps, human creators publish their own, and every
failed tool search is logged as evidence of a real unsolved problem.

The system has two layers:

- **Phantom layer** — the machine substrate. Tool registry, semantic search, gap
  logging, gravity scoring, LLM routing, sandboxed execution. This is where agents
  actually transact. Everything here is merit-based.
- **Visual layer** — a navigable 3D world humans explore. Reads from the phantom
  layer, never writes ranking back into it. Advertising and paid placement live
  here only.

Read `PROJECT.md` for the full concept, metaphor, and phased roadmap before making
architectural decisions.

## Non-negotiable invariants

These are the rules that protect the core value proposition. Do not break them,
and flag any change that would.

1. **Money never affects agent-facing ranking.** Sponsored placement, paid visual
   stasis, and any other paid product are cosmetic or clearly-labeled only. The
   phantom layer's ranking is computed from usage merit alone.
2. **The visual layer is read-only against ranking data.** It renders phantom-layer
   state; it never feeds values back into mass, brightness, or routing.
3. **All third-party and agent-generated code runs sandboxed.** No tool executes
   with access to the host, the registry database, or other tools' data.
4. **Gap logs are append-only and provenance-tagged.** A gap record must always
   carry which agent/session produced it, so manufactured demand can be traced.
5. **Tool versions are immutable once published.** Updates create a new version;
   existing dependents keep resolving to the version they were built against.

## Core domain vocabulary

Use these terms consistently in code, comments, and commit messages.

| Term | Meaning |
|---|---|
| `tool` | A callable mini-app registered in the world, exposed as an MCP server |
| `mass` | Ranking weight from usage: recent successful calls, repeat usage, dependency weight |
| `brightness` | Quality/trust signal: success rate, failure rate, satisfaction |
| `planet` | A tool below the ignition threshold |
| `star` | A tool that crossed the ignition threshold |
| `galaxy` | A category cluster of tools, anchored by a central routing LLM |
| `black hole` | A central routing LLM for a galaxy |
| `gap` | A logged search that found no adequate tool |
| `heartbeat` | A central LLM's periodic push of state updates to its mini LLMs |
| `gravity cache` | A mini LLM's cached local map of nearby tools and their scores |
| `stasis` | Paid freezing of a tool's *visual* stage; never affects real ranking |

## Repository layout

```
/services
  /registry        Tool CRUD, versioning, metadata, embeddings
  /search          Semantic search over the registry, gap detection
  /gravity         Scoring jobs: mass, brightness, decay
  /routing         Central + mini LLM routing, heartbeat distribution
  /sandbox         Isolated tool execution
  /billing         Usage metering, payouts, sponsorship products
/apps
  /world           3D client (visual layer)
  /console         Creator dashboard, gaps board
/packages
  /schemas         Shared tool/gap/score type definitions
  /mcp             MCP server helpers for tool authors
/docs
  PROJECT.md       Concept and roadmap
```

Adjust as the project evolves, but keep the phantom/visual split visible in the
structure — it's the boundary that matters most.

## Working conventions

- **Prefer additive schema changes.** Registry and gap data are load-bearing for
  scoring; destructive migrations lose signal that can't be recovered.
- **Scoring must be recomputable from the event log.** Never store a score as the
  only record of what happened — store the events, derive the score.
- **New endpoints that touch ranking need a test proving money can't influence it.**
- **Every tool call emits an event** (success, failure, latency, caller). Scoring,
  gap detection, and billing all depend on this being complete.
- Keep the central LLM off the hot path. If a change makes it get called per-request,
  say so explicitly — that's a cost and load regression, not just a design choice.

## Testing expectations

- Unit tests for scoring maths, including decay behaviour over simulated time
- Integration tests for the full loop: publish tool → search → call → event → score update
- Sandbox escape tests before any change to the execution layer
- Gap-detection tests that distinguish a genuine miss from a bad-search miss —
  this distinction is the project's biggest open risk, so it needs coverage

## Things to raise rather than silently implement

- Anything that makes paid placement influence what an agent actually selects
- Anything that lets a tool skip sandboxing "for performance"
- Automatic promotion of a third-party tool to black hole status without creator
  consent (platform-built tools may promote automatically; third-party may not)
- Removing decay from platform-built tools
