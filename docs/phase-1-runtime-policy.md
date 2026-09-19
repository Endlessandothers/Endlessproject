# Runtime policy — where a tool executes

**Decided:** 2026-09-19
**Applies from:** Phase 1, issue #3
**Status:** binding. A tool declares its runtime; review verifies the declaration.

Two sandboxes, not one. Both give the same guarantee — **no network, no IAM role,
no writable disk** — and differ only in what they can afford to run.

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
