// Pure ranking maths — no AWS imports, so it is importable by tests without
// installing the SDK. Must stay byte-compatible with packVector in
// ../registry/vector.mjs; infra/tests/vector.test.mjs asserts it.

export const unpackVector = (b64) => {
  const buf = Buffer.from(b64, "base64");
  // A Buffer can be a view into Node's shared pool, so byteOffset matters and
  // Float32Array requires it to be 4-byte aligned. Copying the slice is cheap
  // at this size and removes the alignment question entirely.
  const copy = Uint8Array.prototype.slice.call(buf);
  return Array.from(new Float32Array(copy.buffer));
};

// Vectors are written with normalize:true, so this reduces to a dot product.
// The norms are still divided out so a vector written with normalize:false
// cannot silently skew the ranking.
//
// Note on scale: amazon.titan-embed-text-v2:0 produces cosine values near zero,
// NOT the 0.4-0.8 range typical of other embedding models. Measured 2026-09-14:
// a correct hit scored 0.0595, unrelated tools -0.007 to 0.046. Any threshold
// carried over from another model will be meaningless here.
export function cosine(a, b) {
  if (a.length !== b.length) {
    throw new Error(`dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}
