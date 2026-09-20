# Phase 3 findings

**Written:** 2026-09-20
**Covers:** issues #1–#6 — duplicate check, the builder, the generated-package envelope, provisional publishing, the closure test, and this.

Phase 3's Done-when: *"a recurring gap is closed by a tool no human wrote, and the
closure test confirms the originating queries now resolve."*

**It is met.** For the first time in three phases the answer is yes rather than a
qualified no — though what the phase actually taught is not in that result.

---

## The loop, end to end

```
4 unrelated callers, over 4 days, asked for the same thing four ways
  → nothing in the registry fitted
  → the builder searched first, found nothing, and wrote pokemon-info-lookup
  → 244 bytes against pokeapi.co
  → it ran, on its own sample, before anyone read it
  → published PROVISIONAL, charged 1 credit, unable to execute
  → a person read it and approved it
  → CLOSED: 4 of 4 originating phrasings now resolve to it
  → and it works: bulbasaur, grass/poison, full stats
```

Every step was a real call against the deployed system. The demand was simulated
and quarantined; nothing else was.

---

## The finding: the builder inflates its own demand

This is the one worth remembering, and it was not on anyone's list.

The gap count went from 3 to 36. **Thirty-three of them were the builder asking
"does anything already do this?"** — six times for one need, because the builder
had been run six times against it.

Not noise. A feedback loop: every check the builder makes inflates the demand for
the thing it is checking, which makes that need look more worth building, which
is a justification manufacturing itself. **The exact shape every counting rule in
this project exists to refuse, arriving from the inside rather than from an
attacker.**

A builder's searches now log no gaps and build no competition edges, decided from
the caller's role like every other identity fact. The 33 rows were deleted.

### And fixing it broke the duplicate check, which is the sharper half

`build-tool` decided "nothing fits" by reading `gap_logged` — a **side effect** of
the verdict, filtered by who asked. The moment builder searches stopped logging
gaps it became permanently false, and the check began reporting that
`recent-earthquakes` answers *"what type is pikachu"*.

Left alone it would have refused every generation from then on, with plausible
reasons, silently.

`search-fn` now returns `fits`: the verdict itself. **A side effect should never
have been load-bearing**, and this one was load-bearing in the component whose
whole job is deciding whether to write code.

---

## The second finding: plausible and wrong

The expected failure was duplication — PROJECT.md calls it "the most likely
failure". It was not. The builder's real failure mode is producing something that
looks entirely correct and does not work.

| Round | What it produced | What caught it |
|---|---|---|
| 1 | Declared a web app's **HTML homepage** as an API; handler grepped the markup for "Response Time" | A person, after the novel-host flag |
| 2 | Declared a host that answered, and transformed the answer into `{}` | The new smoke test |
| 3 | `response.includes is not a function` | The new smoke test |

Round one **passed the duplicate check and the entire safety envelope**. Every
automated check said yes. The only reason anyone looked was a flag saying the host
had never been approved.

So a generated package is now run once — real fetcher, real sandbox, its own
sample — before a reviewer is asked for a minute of attention. Rounds two and
three cost seconds each.

**Running is not working**, either: round two "passed" the first version of the
smoke test by returning an empty object. An empty result is now a discard.

---

## The decision the phase turns on

**A generated tool still needs approval.**

The argument for exempting it is good: the sandbox is proven — 22 live escape
attacks, no route, no useful credentials, no reachable filesystem — so generated
code can do no more damage than a person's.

It is not exempted:

- CLAUDE.md says nothing runs *"because it came from a verified source"*, and this
  is the least verified source there has been.
- **The builder is the platform.** A platform that approves its own output has a
  gate protecting against everyone except itself — the confused-deputy shape
  already refused twice, in `exec-fn` and `mcp-fn`.
- A human approving is not a human writing, so the Done-when holds honestly.

Full autonomy needs an independent judge of code. Asking the same platform twice
is not independence, and there is no second party here to be one.

---

## Judge independence, as filed

`deferred-corrections.md` filed this against Phase 3 before any of it existed: the
adjudicator judging a tool the builder just generated is the system marking its
own homework, one level up.

The closure judge sees `tool_id`, `name`, `description` — nothing else. Not
`provisional`, not which model wrote it, not the cluster it was built for. A
generated tool and a person's tool produce a **byte-identical** view, asserted in
a test.

It is not full independence. It removes the one signal that could bias the judge
in either direction, which is what was actually available.

**The deferred correction this closes:** closure is now judged per query by the
adjudicator rather than against a threshold, which was the item filed. Tick it.

---

## A third finding, from the simulation

Two needs failed to register because the adjudicator **falsely matched** them:

| Query | Matched | Which does not do that |
|---|---|---|
| "what currency and capital does a country use" | `currency-convert` | converts amounts between currencies |
| "country information including region and languages" | `worldbank-indicator` | economic indicators |

The consequence is visible on the board: the *country facts* need split into two
withheld singletons instead of clustering into one confirmed need. **A real need
was not recorded because search thought it was already met.**

This is the Phase 0 false-gap problem in its other direction — not a gap logged
when a tool exists, but a gap *not* logged when one does not. Phase 0 measured the
first and never the second, because its eval set had no way to.

---

## What was built

| # | | |
|---|---|---|
| 1 | Duplicate check | Asked of the adjudicator, not of a similarity score |
| 2 | The builder | Nova Pro, given every phrasing, never one query |
| 3 | Envelope + smoke test | 16 KB, no Fargate, 2 upstreams, https — and it must run |
| 4 | Provisional publishing | From the caller's role, so neither side can claim to be the other |
| 5 | **Closure test** | Per query, blind. The Done-when |
| 6 | Findings | This |

A second frozen simulation set, `sim/builder-personas.json`, exists because the
first contains only needs nothing can close. Every need in it fails for the same
reason, so the path where generation *succeeds* was never exercised.

---

## Against the gate

| Must hold | |
|---|---|
| A generated tool cannot execute unapproved | **Yes** — the closure test refused to run until it was approved |
| The duplicate check refuses a met need | **Yes** — refused "weather forecast" against `weather-forecast` |
| The smoke test refuses a tool that does not work | **Yes** — three times |
| The closure judge cannot identify a generated tool | **Yes** — byte-identical view, tested |
| The originating queries resolve afterwards | **Yes** — 4 of 4 |

Five of five. The first phase to clear its own gate outright.

---

## Carried forward

- **Nobody outside this project has used any of it.** Three phases and a Done-when
  met, on simulated demand. The demand was quarantined and the machinery was real,
  which is the most that can be claimed.
- **The generation cost is estimated, not measured.** Bedrock returns a token
  count and the builder discards it — the same mistake Phase 1 corrected for
  search once the tokens were logged. Log it before quoting it.
- **No rate limit on generation.** A builder writes faster than anyone reads, and
  review is the scarce resource. Every check added so far exists to protect a
  reviewer's attention; nothing yet limits how often that attention is asked for.
- **False matches suppress real needs.** Measured here for the first time. Worth
  an eval set that can detect it, which the Phase 0 one cannot.
- **What a caller costs is still undecided**, three phases running. It now gates
  opening registration, paying a bounty, *and* the honesty of every distinct-caller
  count the builder depends on.
