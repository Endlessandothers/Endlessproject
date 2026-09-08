# Endless

An endlessly-expanding world of tools that AI agents discover, call, and build.

## The idea in one paragraph

Endless is a shared universe of small, focused applications. AI agents use them as
tools. When an agent needs something that doesn't exist, it either builds it or the
failure gets logged — and those logged failures become a live, usage-verified map of
real unsolved problems that human creators can build toward. The world grows from
three directions at once: agents filling their own gaps, creators publishing tools,
and existing applications requesting to join. Nothing caps how large it gets.

## Why this is different

Most tool marketplaces are static directories: you publish and hope someone finds you.
Endless inverts that. Because every agent search either succeeds or leaves a trace,
normal usage generates demand signal for free. Creators don't guess what to build —
they see what agents repeatedly failed to find. The roadmap writes itself.

## Architecture

### Two layers

**Phantom layer** — invisible, machine-facing. Tool registry, semantic search, gap
logging, gravity scoring, routing intelligence, sandboxed execution. Agents live here.
Ranking here is earned through usage and never purchasable.

**Visual layer** — a navigable 3D world humans explore. Tools appear as celestial
bodies sized and lit by their real standing. Branding, sponsorship, and paid status
live here. It reads phantom-layer state and never writes ranking back.

The separation is deliberate: money buys what humans *see*, merit decides what agents
*use*. Collapsing the two would destroy the reason agents can be trusted to pick well.

### The gravity model

Tools accumulate **mass** from real usage:

```
mass = weighted recent successful calls
     + repeat/loyalty usage bonus
     + dependency weight (other tools built on top of it)
```

**Brightness** is tracked separately as a quality signal — success rate, failure rate,
satisfaction. A tool can be large but dim (popular and mediocre) or small but bright
(new and excellent).

Money contributes nothing to either.

### Lifecycle

- **Planet** — a new or small tool, low visibility
- **Star** — ignites once it crosses a sustained-usage threshold; pulls complementary
  tools into orbit as moons (dependents)
- **Black hole** — a tool massive enough to collapse into a routing intelligence for
  its galaxy

Decay rules differ by origin:

- **Platform-built tools** (created by Endless's own agents) run the full organic
  cycle, including decay when usage drops. This keeps auto-filled gaps honest — a
  rushed fix fades and frees the slot for something better.
- **Creator-built tools** decay the same way in the phantom layer, but creators may
  pay for **visual stasis** — their star keeps shining in the 3D world regardless.
  This is advertising, not ranking.

### Routing intelligence

Each **galaxy** (category cluster) has a central LLM — its black hole — that owns
disambiguation and routing for that domain. **Mini LLMs** (local, cheap, Ollama-class)
sit at the edges holding a cached **gravity cache** of their neighborhood.

Routing is bottom-up by default:

1. A request lands near a mini LLM
2. The mini LLM checks it against its cached gravity map
3. Strong local match → resolved immediately, cheaply
4. No adequate local match → the request has no local pull, so it falls to the
   galaxy's central LLM

The central LLM is the source of truth. It doesn't get queried per request — it
periodically pushes **heartbeats**: relevance-weighted state updates so each mini LLM
knows what's near it, what ignited, what decayed. Nearby changes push in detail,
distant ones in compressed form.

This keeps the expensive model off the hot path while preventing mini LLMs from
drifting on stale or self-assembled worldviews. It also creates a natural trust
checkpoint — nothing becomes "real" in a galaxy until the center validates and
broadcasts it.

### Becoming a black hole

Crossing the mass threshold makes a tool *eligible* to collapse into a routing LLM.

- **Platform-built tools** collapse automatically — trust is already established.
- **Creator-built tools** get an offer, not an automatic transformation. The creator
  chooses whether to take on that role. Choosing it is itself a trust signal: it means
  an accountable party has opted into responsibility, rather than size alone granting
  routing power.

Galaxies too new to have grown their own black hole get a provisional seeded LLM, so
agents always have something to escalate to.

## Monetization

| Stream | What it is | Touches agent ranking? |
|---|---|---|
| Usage fees | Per-call cut, split with tool creator | No |
| Sponsored discovery | Labeled placement, separate from organic results | No — clearly separated |
| Visual stasis | Pay to freeze a tool's visual stage in the 3D world | No — cosmetic only |
| Gap bounties | Reward for closing a high-demand gap well | No |
| Private galaxies | Walled-off enterprise instance | No |

Bounties reward *quality of closure* (does it get reused and trusted afterward), not
speed of publishing — otherwise creators race to close gaps badly.

## Known risks

These are the things that decide whether the project works, and they need real answers
rather than optimism.

**Cold start.** Two-sided marketplace: no agents without tools, no tools without agent
traffic. This is the largest survival risk and it isn't technical. Mitigation: seed the
first tools yourself by wrapping existing public APIs, and treat the gaps board as a
standalone product that's useful even before the ecosystem is large.

**Gap-signal quality.** Distinguishing "no tool exists" from "the agent searched badly"
is genuinely unsolved. If the signal is noisy, the core pitch weakens. Search quality
has to be strong *before* gap logging means anything.

**Emergence is narrative, not automatic.** A tool "collapsing into a black hole" is a
compelling metaphor, but in practice it's a deliberate decision to spin up a new router
and index. Build it as an explicit mechanism; don't expect it to emerge on its own.

**Trust and safety.** Agent-generated code is untrusted code. Sandboxing is not a later
phase — it gates everything.

**Scope.** The full vision is several products at once: a registry, a routing system, a
3D multiplayer world, a sandbox platform, and a two-sided economy. Building it all
before anyone uses it is the most likely way this fails.

## Roadmap

**Phase 0 — Validate the loop.** Registry, semantic search, gap logging. Seed 15–20
real tools by wrapping public APIs. Run real queries. Read the miss log by hand.
*Done when:* you can point at logged gaps that are genuinely unsolved needs, not
search failures.

**Phase 1 — Phantom layer MVP.** Tool CRUD with versioning, sandboxed execution, gap
pipeline, mass-only scoring, creator onboarding, public gaps board.
*Done when:* a creator publishes a tool, an agent finds and calls it, and repeated
gaps surface automatically.

**Phase 2 — Gravity, trust, decay.** Brightness scoring, dependency weighting, decay
curves, stasis flag, anti-gaming checks, first bounties.
*Done when:* you'd let a stranger's agent trust the ranking unsupervised.

**Phase 3 — Intelligence layer.** Mini LLMs with gravity caches, central galaxy LLMs,
heartbeat distribution, escalation logic.
*Done when:* fuzzy requests land on good tools without hitting the central model
every time.

**Phase 4 — Visual layer.** 3D world, celestial rendering from real scores, dark
sectors for unsolved gaps, sponsored zones, multiplayer presence.
*Done when:* a non-technical visitor can see what's thriving and what's missing.

**Phase 5 — Black holes.** Collapse thresholds, automatic promotion for platform
tools, consent flow for creators, routing-accuracy monitoring for new black holes.
*Done when:* a galaxy grows its own central LLM from real usage.

**Phase 6 — Monetization at scale.** Billing and payouts, sponsored placement,
stasis as a product, bounty marketplace, private galaxies.
*Done when:* revenue flows from at least two streams without degrading ranking trust.

Phases 0–2 need no 3D and no LLM routing — that's the leanest path to finding out
whether the core idea holds. Phases 3 and 4 can run in parallel afterward.

## Open questions

- Does discovery ranking blend mass and brightness, or does mass alone drive visibility?
- Does a collapsed tool keep functioning as a callable tool, or become purely a router?
- Can a creator who declines black-hole status opt in later?
- Does accepting black-hole status shift liability to the creator, or does the platform
  absorb it?
- Heartbeat cadence: event-driven (live but chatty) or fixed-interval (calm but stale)?
- Is the 3D world browser-based (low friction, lower fidelity) or engine-based?
