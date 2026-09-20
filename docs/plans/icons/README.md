# AWS architecture icons

The official AWS service icons used on the Miro board and in the phase decks,
taken from AWS Labs' own icon set rather than redrawn.

They live here so `build-phase-2-deck.py` has one source. The Phase 2 deck
originally pulled them out of `endless-phase-1.pptx` at build time, which meant
the deck could not be rebuilt if that file moved — a generated artefact
depending on another generated artefact.

Each file is named for the service it shows, because a directory of
`image4.png` is a directory nobody can use.
