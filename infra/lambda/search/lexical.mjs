// BM25 lexical scoring — pure, no AWS imports, so tests run on a bare runner.
//
// Why this exists: embeddings blur exactly what a tool registry needs to be
// sharp about. "ISBN", "cron", "kWh", "BM25" are low-frequency, high-signal
// tokens; a dense vector smears them into their neighbourhoods, which is how
// "split this recording into chapters" ended up matching an earthquake feed at
// 0.24. Lexical scoring rewards the rare exact token that cosine ignores.
//
// The corpus is 19 documents. Everything here is recomputed from scratch on
// each cache load, which costs microseconds and removes any chance of the index
// drifting out of step with the rows it was built from.

const STOP = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
  "in", "into", "is", "it", "its", "of", "on", "or", "that", "the", "their",
  "this", "to", "with", "what", "which", "who", "how", "when", "where", "i",
  "me", "my", "you", "your", "can", "do", "does", "get", "give", "tell", "find",
  "want", "need", "please", "am", "was", "were", "will", "would", "should",
]);

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

// Build a BM25 index over {id, text} documents.
export function buildIndex(docs) {
  const postings = new Map(); // term -> Map(docId -> frequency)
  const lengths = new Map();
  for (const d of docs) {
    const terms = tokenize(d.text);
    lengths.set(d.id, terms.length);
    for (const t of terms) {
      if (!postings.has(t)) postings.set(t, new Map());
      const m = postings.get(t);
      m.set(d.id, (m.get(d.id) || 0) + 1);
    }
  }
  const N = docs.length;
  const avgdl = N ? [...lengths.values()].reduce((a, b) => a + b, 0) / N : 0;
  const idf = new Map();
  for (const [term, m] of postings) {
    const df = m.size;
    // Standard BM25 IDF with the +1 guard, so a term present in every document
    // scores ~0 rather than going negative.
    idf.set(term, Math.log(1 + (N - df + 0.5) / (df + 0.5)));
  }
  return { postings, lengths, idf, avgdl, N };
}

const K1 = 1.2;
const B = 0.75;

export function bm25(index, query, docId) {
  const { postings, lengths, idf, avgdl } = index;
  const dl = lengths.get(docId) || 0;
  let score = 0;
  for (const term of tokenize(query)) {
    const m = postings.get(term);
    if (!m) continue;
    const f = m.get(docId);
    if (!f) continue;
    const denom = f + K1 * (1 - B + (B * dl) / (avgdl || 1));
    score += (idf.get(term) || 0) * ((f * (K1 + 1)) / denom);
  }
  return score;
}

// Squash unbounded BM25 into [0,1) so it can be fused with cosine and, more
// importantly, compared against an ABSOLUTE threshold.
//
// Per-query normalisation (divide by the query's own best score) is deliberately
// avoided: it forces the top result to 1.0 for every query including the ones
// nothing can answer, which destroys precisely the signal gap detection needs.
export const SATURATION = 4;
export const saturate = (raw) => raw / (raw + SATURATION);

// Fused score. alpha = 1 is pure cosine, alpha = 0 is pure lexical.
export function fuse(cosine, lexicalNorm, alpha) {
  return alpha * cosine + (1 - alpha) * lexicalNorm;
}
