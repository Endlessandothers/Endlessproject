"""Builds docs/plans/endless-phase-2.pptx.

The deck is generated rather than hand-edited, for the reason the Phase 0 deck
learned the hard way: an edit script that selects shapes by shape matched the
wrong table once and silently overwrote a runbook column. Regenerating from one
source of truth removes the whole class of problem — if the deck is wrong, this
file is wrong, and the fix is visible in a diff.

Style and layout helpers come from deckkit.py, shared with the Phase 3 deck.
Two copies of a layout function is two layouts the moment one is edited, and
these decks are meant to read as one set.

    python docs/plans/build-phase-2-deck.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deckkit import (  # noqa: E402
    deck, slide, text, heading, callout, table, legend_card, verify, icon,
    INK, ORANGE, MUTED, BODY, DIM, WHITE, CALLOUT_BG, CALLOUT_TX,
    DONE_BG, DONE_TX, WARN_BG, WARN_TX, FONT,
)
from pptx.enum.shapes import MSO_SHAPE  # noqa: E402
from pptx.enum.text import PP_ALIGN  # noqa: E402
from pptx.util import Inches, Pt  # noqa: E402

OUT = Path(__file__).resolve().parent / "endless-phase-2.pptx"
prs = deck()


# ---------------------------------------------------------------- 1. title
s = slide(prs)
s.background.fill.solid()
s.background.fill.fore_color.rgb = INK
bar = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(0.28), Inches(7.5))
bar.fill.solid()
bar.fill.fore_color.rgb = ORANGE
bar.line.fill.background()
bar.shadow.inherit = False

text(s, 1.1, 2.05, 11.0, 0.4, "ENDLESS", 13, ORANGE, bold=True)
text(s, 1.1, 2.5, 11.2, 1.2, "Phase 2 — Gravity, trust, decay", 46, WHITE, bold=True)
text(s, 1.1, 3.8, 10.4, 0.9,
     "How a ranking earns trust. Tool-to-tool dependencies, brightness kept separate from\n"
     "mass, decay with a floor, and the first things Endless sells.", 17, MUTED)

# The same six services the Phase 0 and Phase 1 title slides carry, so the three
# decks read as one set rather than three attempts.
for i, name in enumerate(["lambda", "dynamodb", "bedrock", "s3", "cloudfront", "eventbridge"]):
    s.shapes.add_picture(icon(name), Inches(1.1 + i * 0.72), Inches(5.1), Inches(0.55), Inches(0.55))

text(s, 1.1, 6.4, 11.5, 0.3,
     "Done when you would let a stranger's agent trust the ranking unsupervised.", 11.5, DIM)

# ---------------------------------------------------------------- 2. about
s = slide(prs)
heading(s, "ABOUT THIS PHASE", "What Phase 2 is for")
text(s, 0.85, 2.0, 5.5, 3.4,
     "Phase 0 proved the loop could be measured.\n"
     "Phase 1 made it real: sandboxed execution, verified callers,\n"
     "unmet needs surfacing on their own.\n\n"
     "Neither phase asked the question this one does —\n"
     "is the ORDER trustworthy?\n\n"
     "Ranking is the product an agent actually consumes. It picks\n"
     "the first result and calls it. If that order can be bought,\n"
     "gamed, or is simply wrong, everything built so far is a\n"
     "very careful pipeline delivering a bad answer.", 15, BODY, spacing=1.3)
callout(s, 6.7, 2.0, 5.75, 1.5,
        "Phase 2 is the first phase where Endless sells something\nthat touches what agents see.",
        bg=CALLOUT_BG, tx=CALLOUT_TX, size=14)
text(s, 6.95, 3.75, 5.3, 2.6,
     "That is why the invariant — money never reaches agent-facing\n"
     "ranking — stops being a sentence in a document and becomes\n"
     "a test that runs on every scoring pass.\n\n"
     "It is also why brightness is tracked separately from mass\n"
     "rather than folded into one score. A single number hides\n"
     "which half of it moved, and the half that can be bought is\n"
     "exactly the half you need to watch.", 14, BODY, spacing=1.3)

# ---------------------------------------------------------------- 3. starting point
s = slide(prs)
heading(s, "STARTING POINT", "What Phase 1 leaves behind")
table(s, 0.85, 2.0, 11.5, [
    ["", "State at the end of Phase 1"],
    ["Execution", "Sandboxed. 22 live escape attacks, gate clear. Unreviewed code cannot run."],
    ["Identity", "Hashed API keys. Every gap and call carries a verified caller and owner."],
    ["Demand", "Clustered nightly by meaning, counted by distinct callers, published."],
    ["Scoring", "Mass only, recomputed from the log. No brightness, no decay, no dependencies."],
    ["Money", "Publishing costs credits. Searching and calling are free."],
    ["Takedown", "Built. --revoke refuses a version on the very next call."],
    ["Users", "None. No stranger has ever published or called a tool."],
], widths=[1.9, 9.6])
callout(s, 0.85, 4.95, 11.5, 1.05,
        "Three claims this project made about itself turned out to be false when measured, and all three\n"
        "were found by instrumenting rather than reasoning. Phase 2 assumes it will be four.",
        size=13.5)
text(s, 0.85, 6.2, 11.5, 0.8,
     "The wash-trading guard silently did not fire because one person had two owner strings. The sandbox\n"
     "claimed 'no IAM role' and 'no writable disk'; neither was true as written. A private analysis file was\n"
     "served on the open internet because a comment asserted it was not.", 12.5, DIM, spacing=1.25)

# ---------------------------------------------------------------- 4. scope
s = slide(prs)
heading(s, "SCOPE", "What Phase 2 adds, and what it does not")
table(s, 0.85, 1.95, 11.5, [
    ["Adds", "Leaves alone"],
    ["Tool-to-tool dependencies, recorded as a graph", "The sandbox. Nothing in Phase 2 touches it"],
    ["Brightness: success rate and latency, tracked apart", "Retrieval and the gap adjudicator"],
    ["Dependency weight, read off the real graph", "The review gate, other than applying it at depth"],
    ["Decay curves and an archival floor", "Caller identity and the publication fee"],
    ["Stasis: the first paid product touching visibility", "The 3D world itself — stasis is a flag, not a renderer"],
    ["Bounties for closing a confirmed need", "Galaxies, routers and black holes (Phase 5)"],
    ["Anti-gaming checks against the new surfaces", "Agents building their own tools (Phase 3)"],
], widths=[5.75, 5.75])
callout(s, 0.85, 4.7, 11.5, 0.95,
        "Brightness is tracked separately from mass on purpose. A tool can be large and dim, or small and bright,\n"
        "and collapsing that into one number destroys the only signal that says which.", size=13.5)
text(s, 0.85, 5.9, 11.5, 1.1,
     "PROJECT.md's open question — does discovery blend mass and brightness, or does mass alone drive\n"
     "visibility? — is deliberately NOT answered by building a blend. Both are computed and published side by\n"
     "side; whether search ranks on either is a separate decision that needs a re-run of the eval harness,\n"
     "because changing ranking changes what Phase 0 measured.", 12.5, DIM, spacing=1.25)

# ---------------------------------------------------------------- 5. architecture
s = slide(prs)
heading(s, "ARCHITECTURE", "What changes, and where")
table(s, 0.85, 1.95, 11.5, [
    ["Component", "Phase 2 change"],
    ["exec-fn", "Resolves declared dependencies before fetching. Recursion is in process, never Lambda self-invoke"],
    ["deps.mjs", "Depth 3, breadth 4, cycles caught on the chain. Ordering checked at publication"],
    ["tool-runtime", "Receives tools{} beside responses{}. Still no route, no credentials, no reachable filesystem"],
    ["fetcher-fn", "Skipped entirely when a tool declares no requests"],
    ["events table", "Now carries via_tool, depth and root_call_id — this is what makes the graph real"],
    ["cluster-fn", "Gains brightness, dependency weight and decay. Still nightly, still off the hot path"],
    ["board", "tools.json publishes mass and brightness side by side; a bounties view is added"],
], widths=[2.1, 9.4])
callout(s, 0.85, 4.65, 11.5, 1.0,
        "No new DynamoDB table. The free-tier budget is at 23 of 25 RCU/WCU, and every Phase 2 output is\n"
        "derived — so it belongs in a snapshot that can be thrown away and rebuilt, not in a table.", size=13.5)
text(s, 0.85, 5.9, 11.5, 1.0,
     "Nothing Phase 2 computes is stored as the only record of what happened. Mass, brightness, dependency\n"
     "weight and decay are all replayed from the append-only event log on every run — so a scoring rule can\n"
     "change and the whole of history is rescored under it.", 12.5, DIM, spacing=1.25)

# ---------------------------------------------------------------- 6. board layout
s = slide(prs)
heading(s, "THE BOARD", "Where the Phase 2 frame sits")
text(s, 0.85, 1.95, 11.4, 0.4, "miro.com/app/board/uXjVHpGFCos=", 15, ORANGE, bold=True)
table(s, 0.85, 2.5, 11.5, [
    ["Frame", "Size", "What it shows"],
    ["Phase 0 Architecture", "2000 x 1350", "As built and measured. Registry, search, gap logging"],
    ["Phase 1 Architecture", "2400 x 1480", "The phantom layer. Sandbox, identity, clustering, the board"],
    ["Phase 2 Architecture", "2400 x 1520", "Dependencies, the four score components, decay and the floor"],
], widths=[3.0, 1.8, 6.7])
text(s, 0.85, 4.05, 11.5, 2.8,
     "Three frames stacked top to bottom on one infinite canvas, one section-gap apart. There is no slide order\n"
     "and no page one: zooming out shows the whole system and how it grew, which is the thing a static diagram\n"
     "in a deck cannot do.\n\n"
     "The frame is the unit that matters. Everything inside a frame has coordinates relative to that frame's\n"
     "top-left corner, so dragging the frame moves the whole architecture together and nothing drifts out of\n"
     "alignment. Phase 2's frame is the same width as Phase 1's on purpose — the two line up edge to edge, so\n"
     "components that did not change sit directly above their Phase 2 selves.", 13, BODY, spacing=1.3)

# ---------------------------------------------------------------- 7. board legend
s = slide(prs)
heading(s, "THE BOARD", "Reading the Phase 2 frame")
text(s, 0.85, 1.95, 6.5, 4.5,
     "Icons are real AWS assets. Each service carries its official icon as a\n"
     "badge on the card's top-left corner, from AWS Labs' own icon set rather\n"
     "than an approximation.\n\n"
     "Dashed rectangles are zones. They group components by what they are\n"
     "allowed to do rather than by AWS category: callers, execution, sandbox,\n"
     "data, and what the world can see.\n\n"
     "Colour is a claim about change, not decoration. Green means new in this\n"
     "phase, amber means it already existed and is untouched, red is the\n"
     "sandbox, blue is stored state, purple is public.\n\n"
     "Connectors are labelled with what actually crosses them, so an arrow\n"
     "reads 'input, responses, tools' rather than pointing vaguely rightward.\n"
     "A reader can follow one request end to end without the deck.", 13, BODY, spacing=1.3)

legend_card(s, 7.75, 2.0, 4.6, "lambda", "exec-fn", "NEW — resolves declared dependencies", "new")
legend_card(s, 7.75, 2.92, 4.6, "lambda", "registry-fn", "unchanged from Phase 1", "existing")
legend_card(s, 7.75, 3.84, 4.6, "fargate", "tool-runtime", "the sandbox — Phase 2 does not touch it", "sandbox")
legend_card(s, 7.75, 4.76, 4.6, "dynamodb", "events", "now carries via_tool, depth, root_call_id", "data")
legend_card(s, 7.75, 5.68, 4.6, "cloudfront", "gaps board", "public — counts, never identities", "public")
text(s, 7.75, 6.65, 4.6, 0.3, "The card convention used on the board", 11, DIM)

# ---------------------------------------------------------------- 8. moons
s = slide(prs)
heading(s, "FIRST DECISION — BUILT", "Moons: a tool never calls a tool")
text(s, 0.85, 2.0, 6.0, 1.15,
     "A handler cannot reach the registry any more than it can reach\n"
     "the internet. That is the sandbox guarantee, not an obstacle\n"
     "to work around.", 15, BODY, spacing=1.3)
text(s, 0.85, 3.3, 6.0, 2.2,
     "So a tool DECLARES its dependencies and the platform resolves\n"
     "them, passing finished values in:\n\n"
     "    transform({ input, responses, tools })\n\n"
     "The handler never learns another tool exists. It cannot choose\n"
     "one at run time and cannot send one anything that was not\n"
     "written down at publication and read at review.", 14, BODY, spacing=1.3)
callout(s, 7.1, 2.0, 5.35, 1.6,
        "air-by-place composes geocode-place and\nair-quality, opens no connection of its own,\nand returns live air quality from a place name.",
        bg=DONE_BG, tx=DONE_TX, size=13)
text(s, 7.35, 3.8, 5.0, 0.4,
     "The gate holds at every depth:", 13, BODY, bold=True)
callout(s, 7.1, 4.3, 5.35, 1.3,
        "403 dependency where (geocode-place)\nfailed: not approved for execution\n(never reviewed)",
        bg=WARN_BG, tx=WARN_TX, size=12)
text(s, 7.35, 5.75, 5.0, 0.9,
     "An approved tool cannot smuggle in an\nunapproved one.", 13, DIM, spacing=1.25)
text(s, 0.85, 6.3, 6.0, 0.9,
     "Two limits the live run found, not the design: a dependency could\n"
     "not read an earlier one's output, and the fetcher refused a tool\n"
     "that opens no connection.", 12.5, DIM, spacing=1.25)

# ---------------------------------------------------------------- 9. scoring
s = slide(prs)
heading(s, "SECOND DECISION", "Three numbers, kept apart")
table(s, 0.85, 1.95, 11.5, [
    ["", "What it measures", "Why it is separate"],
    ["Mass", "Successful direct calls, verified, non-self", "A call arriving VIA another tool is not somebody choosing you"],
    ["Brightness", "Success rate and latency", "Popular and mediocre must look different from small and excellent"],
    ["Dependency weight", "Distinct dependents, damped per level", "Being built on is real standing, but it is not demand"],
    ["Decay", "Time since sustained use", "Without it, arriving early is permanently worth more than being good"],
], widths=[2.3, 4.3, 4.9])
callout(s, 0.85, 3.85, 11.5, 1.0,
        "A tool called a thousand times through one popular dependent has one dependent, not a thousand callers.\n"
        "Counting those as demand is how a dependency graph turns into a popularity illusion.", size=13.5)
text(s, 0.85, 5.1, 11.5, 1.9,
     "Every component is computed and published; none is blended into a single score in Phase 2. That is a\n"
     "deliberate refusal rather than an omission — blending requires knowing the weights, the weights come from\n"
     "watching real traffic, and there is no real traffic yet.\n\n"
     "Publishing the components separately also means anyone reading the board can disagree with the ranking\n"
     "rather than having to trust it, which is the same reason the gaps board shows what it withheld and why.",
     13, BODY, spacing=1.3)

# ---------------------------------------------------------------- 10. lifecycle
s = slide(prs)
heading(s, "THIRD DECISION", "Decay, the floor, and the difference from takedown")
table(s, 0.85, 1.95, 11.5, [
    ["", "What happens", "Reversible?"],
    ["Decay", "Score falls as sustained use drops. Platform-built and creator-built decay alike", "Yes — usage returning raises it"],
    ["Archival floor", "Stops appearing in discovery. Rows and version history stay", "Yes"],
    ["Takedown", "Execution refused immediately. Never automatic, always a person", "Yes, by re-approving"],
    ["Stasis", "Visual only. The star keeps shining in the 3D world", "Paid, cosmetic, changes no ranking"],
], widths=[2.1, 7.2, 2.2])
callout(s, 0.85, 3.85, 11.5, 1.05,
        "Archived, never deleted. Anything that ever depended on a tool still has to resolve it — and Phase 2 is\n"
        "the phase that makes dependencies real, so this stops being hypothetical the moment it ships.", size=13.5)
text(s, 0.85, 5.2, 11.5, 1.8,
     "Takedown already exists and was drilled rather than assumed: approve, call succeeds, revoke, and the very\n"
     "next call is refused. Approvals are not cached for exactly this reason.\n\n"
     "Decay is the opposite kind of mechanism — slow, automatic, and driven by a curve nobody has data for yet.\n"
     "It is the parameter in this phase most likely to be wrong on the first attempt.", 13, BODY, spacing=1.3)

# ---------------------------------------------------------------- 11. the hard part
s = slide(prs)
heading(s, "THE HARD PART", "Every number here is a fitted curve")
text(s, 0.85, 2.0, 11.5, 1.2,
     "Decay half-life. Dependency damping. The brightness floor. How much a dependent is worth.\n"
     "Each is a number somebody has to choose, and Phase 0 already showed what happens when one is guessed.",
     15, BODY, spacing=1.3)
callout(s, 0.85, 3.25, 11.5, 1.1,
        "A threshold fitted to one query set gave 0% false gaps on that set and 31.6% on a held-out one.\n"
        "Four more of those, stacked and compounding, is how a ranking quietly stops being worth trusting.",
        bg=WARN_BG, tx=WARN_TX, size=13.5)
text(s, 0.85, 4.65, 11.5, 2.3,
     "So the rule for this phase: every parameter either ships with its derivation, or ships marked provisional in\n"
     "the variable that holds it. No exceptions, and no number that merely looks settled.\n\n"
     "The blind simulation in sim/ is the instrument. It already replaced the clustering similarity guess of 0.5\n"
     "with a measured 0.35 — and, more usefully, established that the within-need and across-need distributions\n"
     "OVERLAP, so no perfect threshold exists and the real question is which error to prefer.\n\n"
     "Where the simulation cannot settle a number, the number says so. That is a finding, not a failure.",
     13, BODY, spacing=1.3)

# ---------------------------------------------------------------- 12. money
s = slide(prs)
heading(s, "THE INVARIANT UNDER TEST", "Money never reaches agent-facing ranking")
table(s, 0.85, 1.95, 11.5, [
    ["Phase 2 paid product", "What it buys", "Touches ranking?"],
    ["Visual stasis", "A star keeps shining in the 3D world when usage drops", "No — cosmetic only"],
    ["Gap bounties", "A reward for closing a confirmed unmet need well", "No — rewards closure quality"],
], widths=[3.0, 6.3, 2.2])
callout(s, 0.85, 3.2, 11.5, 1.05,
        "assertNoPaidInputs runs over every scored row on every nightly pass. A field derived from payment\n"
        "reaching the scorer fails the run loudly rather than quietly publishing a bought ranking.", size=13.5)
text(s, 0.85, 4.5, 11.5, 2.4,
     "The standing commitment says every new paid product gets a test proving it does not reach ranking. Stasis\n"
     "is the first product that makes that commitment cost something, because it is genuinely adjacent — it buys\n"
     "visibility in the world, and the argument that world visibility is not ranking has to hold up.\n\n"
     "Bounties reward quality of closure judged after the fact, never speed of publishing; otherwise creators race\n"
     "to close gaps badly. And the closer's own demand is removed from the evidence before the reward is\n"
     "assessed, because whoever benefits from a need looking urgent is the person who closes it.",
     13, BODY, spacing=1.3)

# ---------------------------------------------------------------- 13. plan
s = slide(prs)
heading(s, "PLAN", "Eight issues")
text(s, 0.85, 1.95, 11.4, 0.4, "Estimates for one developer. #1 is done.", 15, BODY)
table(s, 0.85, 2.45, 11.5, [
    ["#", "Issue", "Est.", "Depends on"],
    ["1", "Tool-to-tool calls through the registry, recorded as a graph", "M", "— DONE"],
    ["2", "Brightness: success rate and latency, tracked separately from mass", "S", "1"],
    ["3", "Dependency weighting, damped, read off the recorded graph", "M", "1"],
    ["4", "Decay curves and the archival floor", "M", "2, 3"],
    ["5", "Stasis flag, with the test proving it never reaches ranking", "S", "4"],
    ["6", "Anti-gaming checks against the new surfaces", "M", "3, 4"],
    ["7", "First bounties: posting, closure test, beneficiary exclusion", "L", "4, 6"],
    ["8", "Phase 2 findings, with every parameter's derivation or its absence", "S", "all"],
], widths=[0.6, 7.3, 1.1, 2.5])
callout(s, 0.85, 5.55, 11.5, 1.35,
        "#6 is a gate, not a task. Anti-gaming has to pass before bounties exist, because a bounty is the first\n"
        "thing in Endless actually worth gaming — and the incentive to game a ranking arrives with the money,\n"
        "not before it.", size=13.5)

# ---------------------------------------------------------------- 14. sequencing
s = slide(prs)
heading(s, "SEQUENCING", "What blocks what")
text(s, 0.85, 2.05, 11.5, 0.5,
     "#1 Moons  →  #2 Brightness  ·  #3 Dependency weight  →  #4 Decay  →  #5 Stasis  →  #6 Anti-gaming  →  #7 Bounties",
     14, INK, bold=True)
text(s, 0.85, 2.85, 11.5, 4.0,
     "#1 came first because nothing else was measurable without it. PROJECT.md is explicit: without recorded\n"
     "tool-to-tool calls there is nothing to weigh, so dependency weight would have been a claim rather than a\n"
     "measurement. It is now in the event log as via_tool, depth and root_call_id.\n\n"
     "#2 and #3 can run in parallel. Brightness needs only the outcome and duration already recorded; dependency\n"
     "weight needs only the graph. Neither waits on the other.\n\n"
     "#4 is where the guessing risk concentrates. Decay is one curve that changes every score on the board, and\n"
     "it is the parameter with the least data behind it. Derive it against the simulation before it ships.\n\n"
     "#6 gates #7. The moment a bounty is payable, there is a reason to manufacture the need that justifies it —\n"
     "and the counting rules that defend against that were written for a world with no prize attached.\n\n"
     "#8 is the exit, as in both previous phases. The gate clears, or a written finding says why it does not.",
     13, BODY, spacing=1.3)

# ---------------------------------------------------------------- 15. cost
s = slide(prs)
heading(s, "COST", "What Phase 2 adds to the bill")
table(s, 0.85, 1.95, 11.5, [
    ["", "Phase 1 measured", "Phase 2 effect"],
    ["Per search", "$14.87 per million", "Unchanged — Phase 2 does not touch retrieval"],
    ["Per tool call", "$3.64 per million", "Multiplied by chain length: a 3-deep call is 3 executions"],
    ["Nightly scoring", "Negligible", "Grows with the event log, not with traffic rate"],
    ["The board", "Free at any plausible volume", "Unchanged — static objects behind CloudFront"],
], widths=[2.3, 3.6, 5.6])
callout(s, 0.85, 3.85, 11.5, 1.05,
        "Depth 3 and breadth 4 are cost controls as much as safety ones. One call to a fully nested tool is\n"
        "thirteen sandbox executions, and that is the number those two limits were chosen to bound.", size=13.5)
text(s, 0.85, 5.15, 11.5, 1.85,
     "Phase 1 measured that a search costs 4.1x running a tool, which was backwards from the intuition — search\n"
     "pays for two model calls and execution pays for none. Composition changes that arithmetic: a deep chain is\n"
     "several executions and still no model calls, so it stays the cheap side.\n\n"
     "The sandbox itself remains rounding error at 4ms p50, which is worth re-stating whenever Fargate is raised.",
     13, BODY, spacing=1.3)

# ---------------------------------------------------------------- 16. risks
s = slide(prs)
heading(s, "RISKS", "What could go wrong")
table(s, 0.85, 1.95, 11.5, [
    ["Risk", "Why it bites here"],
    ["Guessed curves compound", "Four parameters, each fitted to almost no data, multiplying into one order"],
    ["Dependency weight is gameable", "Publish tools that depend on your own, and standing appears from nothing"],
    ["Decay punishes the seasonal", "A tool used heavily once a quarter looks identical to one nobody wants"],
    ["Stasis erodes the trust claim", "Cosmetic today; the pressure to let it touch ranking arrives with revenue"],
    ["Bounties reward speed", "Racing to close a gap badly is easier than closing it well, unless judged after"],
    ["Still no users", "Trusting a ranking unsupervised cannot be demonstrated without somebody to trust it"],
], widths=[3.4, 8.1])
callout(s, 0.85, 4.35, 11.5, 1.1,
        "Self-dealing through dependencies is the one genuinely new attack surface. The self-call rule already\n"
        "covers an owner calling their own tool; it says nothing yet about an owner DEPENDING on their own tool.",
        bg=WARN_BG, tx=WARN_TX, size=13.5)
text(s, 0.85, 5.75, 11.5, 1.2,
     "That gap is why #6 exists and why it gates bounties. The fix is likely the same shape as the one that works\n"
     "elsewhere: count distinct owners rather than occurrences, and discount the beneficiary. It has to be\n"
     "measured against the simulation rather than assumed to transfer.", 12.5, DIM, spacing=1.25)

# ---------------------------------------------------------------- 17. the gate
s = slide(prs)
heading(s, "THE GATE", "What would prove Phase 2")
text(s, 0.85, 2.0, 11.5, 0.6,
     "Phase 0's gate passed while a third of answerable queries were being logged as unmet needs, because the\n"
     "gate never asked about false gaps. These are written to avoid repeating that.", 14, BODY, spacing=1.3)
table(s, 0.85, 2.95, 11.5, [
    ["Must hold", "How it is checked"],
    ["Every parameter has a derivation or is marked provisional", "Read the variable descriptions; no silent defaults"],
    ["Dependency weight cannot be self-awarded", "Simulated owner depending on their own tool gains nothing"],
    ["A paid field cannot reach a score", "assertNoPaidInputs fails the nightly run, tested deliberately"],
    ["Decay does not archive something still in use", "Replay the log at several half-lives and compare"],
    ["An archived tool still resolves for dependents", "Call a tool whose dependency has been archived"],
], widths=[5.4, 6.1])
callout(s, 0.85, 4.95, 11.5, 1.0,
        "And the honest row: none of this demonstrates that a stranger would trust the ranking, because there is\n"
        "still no stranger. Phase 2 can prove the ranking is defensible; it cannot prove it is trusted.", size=13.5)
text(s, 0.85, 6.2, 11.5, 0.8,
     "The gate clears, or a written finding says why it does not — as in both previous phases.", 12.5, DIM)

# ---------------------------------------------------------------- 18. start here
s = slide(prs)
heading(s, "START HERE", "The first four moves")
rows = [
    ("1", "Brightness (#2)", "Success rate and latency are already in the event log. It is the cheapest real\nnumber in the phase and it needs no new data."),
    ("2", "Dependency weight (#3)", "The graph exists as of #1. Damping is the first parameter to derive against the\nsimulation rather than choose."),
    ("3", "Self-dependency check (#6, early)", "Before decay, not after. It is a new attack surface that the existing anti-gaming\nrules were not written for."),
    ("4", "Decay (#4)", "Last of the four, because it changes every score at once and has the least data\nstanding behind it."),
]
y = 2.05
for num, title_, body_ in rows:
    chip = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(0.85), Inches(y), Inches(0.4), Inches(0.4))
    chip.fill.solid()
    chip.fill.fore_color.rgb = ORANGE
    chip.line.fill.background()
    chip.shadow.inherit = False
    tf = chip.text_frame
    tf.text = num
    tf.paragraphs[0].alignment = PP_ALIGN.CENTER
    r = tf.paragraphs[0].runs[0]
    r.font.size = Pt(12)
    r.font.bold = True
    r.font.name = FONT
    r.font.color.rgb = WHITE
    text(s, 1.45, y - 0.03, 3.1, 0.4, title_, 15, INK, bold=True)
    text(s, 4.6, y - 0.03, 7.8, 0.9, body_, 13, BODY, spacing=1.25)
    y += 1.15

callout(s, 0.85, 6.75, 11.5, 0.6,
        "Unchanged and unaffected by any of this: minting a caller still costs nothing.", size=13)

prs.save(OUT)
problems = verify(OUT)
print(f"wrote {OUT.name} — {len(prs.slides._sldIdLst)} slides")
for p in problems:
    print(f"  LAYOUT: {p}")
if not problems:
    print("  no overflow, no overlap")
