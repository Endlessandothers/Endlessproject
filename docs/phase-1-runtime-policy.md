# Runtime policy — where a tool executes

**Decided:** 2026-09-19
**Applies from:** Phase 1, issue #3
**Status:** binding. A tool declares its runtime; review verifies the declaration.

Two sandboxes, not one. Both give the same guarantee — **no network, no useful
credentials, no reachable filesystem** — and differ only in what they can afford
to run.

That wording is deliberate and was corrected after it was measured. See
"What the guarantee actually is" below: the earlier phrasing, "no IAM role, no
writable disk", was not true as written.

| | `lambda-vpc` | `fargate` |
|---|---|---|
| For | ordinary transforms | compute-heavy or library-heavy work |
| Cost | inside the always-free tier | billed per task-second |
| Cold start | ~100–400 ms | seconds |
| Package ceiling | 250 MB unzipped, 10 GB with a container image | effectively unbounded |
| Native libraries | awkward; must match the Lambda image | anything that runs in a container |
| Wall clock | up to 15 minutes, but pay-per-ms discourages it | long jobs are fine |

**Default is `lambda-vpc`.** Fargate is opt-in and must be justified, because it is
the only part of Phase 1 that leaves the free tier.

## Which one a tool gets

Declare `fargate` if **any** of these is true. Otherwise `lambda-vpc`.

1. **Native or binary dependencies.** Image processing, PDF rendering, ffmpeg,
   headless browsers, anything compiled against system libraries.
2. **A dependency tree over ~50 MB.** Scientific Python, ML runtimes, large SDKs.
3. **Sustained CPU.** More than roughly a second of real computation per call —
   parsing large documents, numerical work, compression.
4. **Memory above 2 GB.**
5. **Runs longer than ~30 seconds** in normal use.

Everything else is a transform over a JSON response: parse, reshape, compute a
small result, return. That is `lambda-vpc`, and it is where most tools belong.

## Why the split rather than one runtime

**One runtime forces a bad trade.** All-Fargate means every trivial tool pays
per-second billing and a multi-second cold start, and Phase 1 leaves the free tier
on day one. All-Lambda means the first tool needing a native library either cannot
be published or gets an exception, and exceptions to a sandbox rule are how sandbox
rules die.

**The guarantee is identical either way**, so the split costs nothing in safety.
Both run with no network route, a null IAM role and a read-only filesystem; the
platform fetcher is the only component that can reach the internet. Choosing between
them is an operational decision about cost and capability, not a security one — which
is exactly the kind of decision that is safe to let a creator make and a reviewer
check.

## How it is enforced

- `manifest.json` carries `runtime` and `runtime_reason`.
- Review rejects `fargate` without a reason matching one of the five triggers.
- Review rejects `lambda-vpc` if the package obviously breaches a trigger — a
  50 MB dependency tree is visible without running anything.
- Misclassification is not a security failure. A heavy tool on Lambda times out or
  runs out of memory, and a light tool on Fargate merely costs more than it should.
  Both are visible, and neither breaches the sandbox.

## What this does not decide

**Whether Fargate is affordable at volume.** Nothing has executed yet, so cost per
call is unmeasured. `PROJECT.md`'s standing commitment — *measure per-call cost
continuously* — applies here first. Publish the number with the Phase 1 findings and
revisit this policy against it rather than against intuition.


## What the guarantee actually is

Measured against the deployed sandbox by `infra/tests/escape.live.mjs`
(2026-09-19), not asserted. Two of the three claims originally made here were
loose, and a security claim that is loose is worse than one that is narrow.

**"No network" — true, and it is the whole boundary.** A handler that escapes the
source screen completely, reaches the global object and calls `fetch` on a host
that certainly answers gets nothing: the call hangs until the transform timeout
cuts it off at 5 seconds. There is no route, so there is nowhere to go.

**"No IAM role" — false as written.** The runtime has a role; it must, or Lambda
cannot attach an ENI. An escaped handler reads real credentials for it out of the
environment, and the test asserts that it can: `credentials readable: true`.
Those credentials are worthless twice over — the role grants nothing but its own
log stream, and there is no route to an AWS endpoint to present them to. The
honest claim is **no useful credentials**, and the reason they are useless is the
Deny policy and the missing route, not their absence.

**"No writable disk" — not what was measured.** Lambda always provides a writable
`/tmp` that survives between invocations on a warm container, so a handler that
could reach the filesystem could leave data for whatever tool ran next on the
same container. It cannot reach it: `import` and `require` are screened, and
after a full escape to the global object there is no module loader to be found —
`process.mainModule` is undefined under ES modules. So the accurate claim is
**no reachable filesystem**, and it rests on the absence of a loader rather than
on the absence of a disk.

**The screen is not a boundary and is not treated as one.** The test suite
defeats it on purpose, via `[].constructor.constructor("return this")()`, which
contains none of the forbidden tokens. That case is there permanently: it is what
makes the following two cases mean something. The screen exists so that a tool
written to reach outward is refused loudly and attributably rather than hanging
silently — not to contain anything.

**A synchronous infinite loop is not caught by the transform timeout.** It blocks
the event loop, so the `Promise.race` cannot fire, and Lambda's own 30-second
timeout stops it instead. The difference is operational rather than a breach: an
async hang costs 5 seconds and returns a structured error, a spin costs 30 and
returns none.
