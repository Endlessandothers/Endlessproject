import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tokenize, buildIndex, bm25, saturate, fuse, SATURATION,
} from "../lambda/search/lexical.mjs";

const DOCS = [
  { id: "isbn", text: "Published book record from its ten or thirteen digit ISBN: title, authors, publisher." },
  { id: "weather", text: "Weather forecast by hour and by day: temperature, rainfall probability, wind speed." },
  { id: "quake", text: "Earthquakes recorded worldwide with magnitude, depth, origin time and epicentre place name." },
];

test("tokenize lowercases, splits and drops stopwords", () => {
  assert.deepEqual(tokenize("What is the ISBN of A Book?"), ["isbn", "book"]);
});

test("tokenize drops single characters and punctuation", () => {
  assert.deepEqual(tokenize("a b cc, d-e!"), ["cc"]);
});

test("a rare token beats a common one", () => {
  const idx = buildIndex(DOCS);
  // "isbn" appears in one document; it should carry far more weight than a
  // term spread across the corpus.
  assert.ok(idf(idx, "isbn") > idf(idx, "and"));
  function idf(index, t) { return index.idf.get(t) ?? 0; }
});

test("bm25 ranks the document containing the query term", () => {
  const idx = buildIndex(DOCS);
  const q = "isbn of this book";
  const scores = DOCS.map((d) => [d.id, bm25(idx, q, d.id)]).sort((a, b) => b[1] - a[1]);
  assert.equal(scores[0][0], "isbn");
  assert.ok(scores[0][1] > 0);
});

test("bm25 is zero when no query term appears in the document", () => {
  const idx = buildIndex(DOCS);
  assert.equal(bm25(idx, "cryptocurrency portfolio", "weather"), 0);
});

test("saturate maps to [0,1) and is monotonic", () => {
  assert.equal(saturate(0), 0);
  assert.ok(saturate(1) < saturate(5));
  assert.ok(saturate(1e6) < 1);
  assert.ok(Math.abs(saturate(SATURATION) - 0.5) < 1e-12);
});

// The property that matters for gap detection: an absolute scale. Per-query
// normalisation would force every query's best result to 1.0, including queries
// nothing can answer, erasing the signal the threshold depends on.
test("saturation is absolute, not per-query", () => {
  const strong = saturate(12);
  const weak = saturate(0.3);
  assert.ok(strong > 0.7, `expected a strong lexical match to stay high, got ${strong}`);
  assert.ok(weak < 0.1, `expected a weak lexical match to stay low, got ${weak}`);
});

test("fuse honours alpha at both extremes", () => {
  assert.equal(fuse(0.8, 0.2, 1), 0.8);
  assert.equal(fuse(0.8, 0.2, 0), 0.2);
  assert.ok(Math.abs(fuse(0.8, 0.2, 0.5) - 0.5) < 1e-12);
});

test("an empty corpus does not divide by zero", () => {
  const idx = buildIndex([]);
  assert.equal(bm25(idx, "anything", "missing"), 0);
});
