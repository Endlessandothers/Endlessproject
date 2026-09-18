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

Decay has a floor. A tool that reaches it is archived rather than deleted: it stops
appearing in discovery, but its rows and its version history remain, because anything
that ever depended on it still needs to resolve. Archival is reversible if usage
returns. Takedown — for a tool that turns out to be harmful — is a separate, faster
path that revokes execution immediately and is never automatic.

### Moons: how one tool depends on another

A tool becomes a moon by calling another tool through the registry rather than
reaching for an external API directly. That call is recorded, which is what makes the
dependency graph real and what lets dependency weight flow from a dependent to the
thing it relies on. Without recorded tool-to-tool calls there is nothing to weigh, so
this mechanism has to exist before dependency weighting means anything.

Depth of propagation is capped, and cycles are detected rather than allowed to
propagate indefinitely.

### Galaxies: how the world gets organised

A **galaxy** is a cluster of tools in one domain, anchored by a central routing LLM.
Galaxies are not hand-drawn categories. They form from the embedding space the
registry already maintains — tools cluster by capability, and a cluster becomes a
galaxy once it is dense enough to warrant its own router.

Two things follow from that:

- Tool assignment is computed, not declared. A creator does not choose a galaxy; the
  clustering places the tool, and a tool can be reassigned as the space around it
  changes.
- Galaxy boundaries move. Clusters split when they grow, and merge when they thin out.
  A tool's galaxy is current state, never a permanent address.

Requests that span galaxies are handled by a thin classifier above them — closer to a
law of gravity than to another reasoning model. Its only job is deciding which
galaxy or galaxies a request belongs to before handing off.

### Routing intelligence

Each galaxy has a central LLM — its black hole — that owns disambiguation and routing
for that domain. **Mini LLMs** (local, cheap, Ollama-class) sit at the edges holding a
cached **gravity cache** of their neighborhood.

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

### Agents building their own tools

When an agent hits a gap, the gap is logged. When that gap recurs across enough
distinct callers, a builder agent may attempt to close it.

The sequence matters:

1. Search the registry first. Generating a near-duplicate of something that already
   exists is the most likely failure, and it inflates the world without adding to it.
2. Build against the gap cluster, not against a one-off query — the cluster is what
   carries the evidence of real demand.
3. Publish as **provisional**: callable, visibly auto-generated, ranked below reviewed
   tools until it earns usage of its own.
4. Run a **closure test** — do the queries in the originating cluster now resolve to
   this tool above threshold? A gap does not close because something was published; it
   closes because the need is met.
5. Apply full decay, per the platform-built rule above. A rushed fix that nobody
   reuses should fade and free the slot.

Step 4 exists because the builder and the selector are the same system judging its own
work. Without an independent closure test, a bad tool can make a gap look solved while
the need persists — and the gaps board, which is the product, would be quietly lying.

### Applications joining from outside

An existing product can request to join rather than being built inside Endless. This
is the third growth direction and it needs a different path from creator onboarding:
the tool already exists, has its own users, and its owner is accountable elsewhere.

What that path requires: verification of ownership, a declared capability description
that the registry can embed, an execution contract (does Endless call their endpoint,
or do they run inside the sandbox), and a trust marker distinguishing a verified
external app from an anonymous submission. Fast-tracked review is a legitimate paid
product; a purchased trust marker is not.

## Monetization

| Stream | What it is | Touches agent ranking? |
|---|---|---|
| Usage fees | Per-call cut, split with tool creator | No |
| Sponsored discovery | Labeled placement, separate from organic results | No — clearly separated |
| Visual stasis | Pay to freeze a tool's visual stage in the 3D world | No — cosmetic only |
| Gap bounties | Reward for closing a high-demand gap well | No |
| Expedited review | Faster onboarding for a joining application | No — speed only, never status |
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

**Density.** Gap detection can be measured at twenty tools and behave completely
differently at two thousand, where near-misses crowd together and one global threshold
stops separating a genuine gap from a retrieval failure. A small corpus flatters every
recall number it produces. This risk cannot be closed early — it can only be re-measured
as the world grows, which is why the eval harness is a standing instrument rather than
a one-off script.

**The builder judges its own work.** The system that generates a tool to close a gap is
the same system that later selects tools. If the generated tool is weak and nothing
better exists, the selector picks it anyway and the gap reads as closed. The closure
test is the control; without it, auto-generation degrades the gaps board rather than
serving it.

**Emergence is narrative, not automatic.** A tool "collapsing into a black hole" is a
compelling metaphor, but in practice it's a deliberate decision to spin up a new router
and index. Build it as an explicit mechanism; don't expect it to emerge on its own.

**Trust and safety.** Agent-generated code is untrusted code. Sandboxing is not a later
phase — it gates everything. Sandboxing also solves execution safety, not answer
quality: a perfectly isolated tool can return confident nonsense, and brightness is the
only defense against that.

**Cost scales with usage.** Sandbox compute, embedding calls and central-LLM routing
all grow with traffic, and all of them sit on the path of a free tool call. Per-call
cost has to be measurable before usage fees are designed, or the economics are guessed.

**Scope.** The full vision is several products at once: a registry, a routing system, a
3D multiplayer world, a sandbox platform, and a two-sided economy. Building it all
before anyone uses it is the most likely way this fails.

## Roadmap

**Phase 0 — Validate the loop.** Registry, semantic search, append-only event log, gap
logging. Seed 15–20 real tools by wrapping public APIs. An evaluation set written blind
and frozen before seeding, with about a quarter of its queries deliberately
unanswerable. Four numbers: recall@1, recall@3, false-gap rate, gap-detection rate.
Threshold T derived from the resulting score distributions rather than guessed.
*Done when:* the gate clears — or a written finding says why it doesn't.

**Phase 1 — Phantom layer MVP.** Tool CRUD with versioning, sandboxed execution,
caller identity so events carry real provenance, gap clustering, mass-only scoring,
creator onboarding with a review gate, public gaps board.
*Done when:* a creator publishes a tool, an agent finds and calls it, and repeated
gaps surface automatically.

**Phase 2 — Gravity, trust, decay.** Tool-to-tool calls through the registry,
brightness scoring, dependency weighting, decay curves and the archival floor, the
takedown path, stasis flag, anti-gaming checks, first bounties.
*Done when:* you'd let a stranger's agent trust the ranking unsupervised.

**Phase 3 — Agents building tools.** Builder agent, duplicate check before generation,
provisional publishing, the closure test, decay applied to generated tools.
*Done when:* a recurring gap is closed by a tool no human wrote, and the closure test
confirms the originating queries now resolve.

**Phase 4 — Applications joining.** Ownership verification, capability declaration,
execution contract for externally-hosted tools, trust markers, expedited review as a
product.
*Done when:* an application Endless didn't build is serving agent traffic inside it.

**Phase 5 — Galaxies and the intelligence layer.** Clustering tools into galaxies,
split/merge as clusters change, the cross-galaxy classifier, mini LLMs with gravity
caches, central galaxy LLMs, heartbeat distribution, escalation logic.
*Done when:* fuzzy requests land on good tools without hitting the central model
every time.

**Phase 6 — Visual layer.** 3D world, celestial rendering from real scores, dark
sectors for unsolved gaps, sponsored zones, multiplayer presence.
*Done when:* a non-technical visitor can see what's thriving and what's missing.

**Phase 7 — Black holes.** Collapse thresholds, automatic promotion for platform
tools, consent flow for creators, routing-accuracy monitoring for new black holes.
*Done when:* a galaxy grows its own central LLM from real usage.

**Phase 8 — Monetization at scale.** Billing and payouts, sponsored placement,
stasis as a product, bounty marketplace, private galaxies.
*Done when:* revenue flows from at least two streams without degrading ranking trust.

Phases 0–2 need no 3D and no LLM *routing* — that's the leanest path to finding out
whether the core idea holds. Phase 3 needs the sandbox from Phase 1 and decay from
Phase 2, which is why it sits where it does rather than earlier. Phases 4 and 6 can
run in parallel with the phases around them; Phase 5 is the prerequisite for Phase 7.

**But an LLM is required from Phase 0, and this is settled rather than open.** There
are two distinct small models in this design, and only one of them is deferrable:

- **The adjudicator.** Given a request and the top few candidates, it answers whether
  any of them genuinely does the job. It replaces the gap threshold, and it is on the
  path of every search from Phase 0 onward.
- **The router.** The mini LLMs of Phase 5, holding gravity caches and deciding where
  a request goes before anything is retrieved. That one waits.

Phase 0 measured the difference. Deciding a gap by comparing a similarity score
against a fixed threshold produced a 20% false-gap rate across two evaluation sets —
and swung from 0% on the set that chose the threshold to 31.6% on a held-out one,
because the score scale moves with how a question is phrased. Replacing that
comparison with an adjudicator took false gaps to 6.7% and gap detection to 96.7%.

Retrieval was never the weak part: recall@3 was 100% on both sets, and in every false
gap the correct tool was already in the top three. What could not be done by
arithmetic was judging whether a candidate is *good enough* — so the adjudicator moves
to Phase 0 and the roadmap should not be read as deferring it.

## Standing commitments

These are not phases. They apply from the phase that introduces them onward, and
skipping one silently is how the project rots.

- **Re-run the eval harness at every tenfold increase in corpus size.** Twenty tools,
  two hundred, two thousand. The number that matters is the trend in distribution
  overlap, not any single reading.
- **Sandboxing gates execution.** No tool runs unsandboxed for performance, for
  convenience, or because it came from a verified source.
- **Scores stay recomputable from the event log.** Never store a score as the only
  record of what happened.
- **Measure per-call cost continuously.** Compute, embeddings and routing all sit on
  the path of every call.
- **Money never reaches agent-facing ranking.** Every new paid product gets a test
  proving it doesn't.

## Open questions

- Does discovery ranking blend mass and brightness, or does mass alone drive visibility?
- Is a single global threshold viable at all, or does gap detection need a per-query
  rule — top-1 against top-2 margin, rather than an absolute score?
- Does a collapsed tool keep functioning as a callable tool, or become purely a router?
- Can a creator who declines black-hole status opt in later?
- Does accepting black-hole status shift liability to the creator, or does the platform
  absorb it?
- Who owns a tool an agent generated — the platform, or whoever posted the bounty?
- Heartbeat cadence: event-driven (live but chatty) or fixed-interval (calm but stale)?
- Is the 3D world browser-based (low friction, lower fidelity) or engine-based?
