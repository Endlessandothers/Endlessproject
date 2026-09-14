// Tests for the vector wire format shared by registry and search.
//
// These import only the pure modules, so they run on a bare Node 20 with no
// npm install and no AWS credentials.
//
// The cross-module round-trip is the point. packVector ships inside the
// registry Lambda package and unpackVector ships inside the search package;
// they are deployed separately and can drift independently. If they ever
// disagree, ranking degrades silently — the order stays plausible while the
// scores are wrong, which is the hardest kind of bug to notice.

import { test } from "node:test";
import assert from "node:assert/strict";
import { packVector } from "../lambda/registry/vector.mjs";
import { unpackVector, cosine } from "../lambda/search/vector.mjs";

const F32 = (n) => Math.fround(n);

test("pack then unpack preserves values within float32 precision", () => {
  const original = [0.1, -0.25, 0.5, 0, 1, -1, 0.333333];
  const restored = unpackVector(packVector(original));

  assert.equal(restored.length, original.length);
  for (let i = 0; i < original.length; i++) {
    assert.equal(restored[i], F32(original[i]));
  }
});

test("round-trip holds at the real 1024-dimension size", () => {
  const v = Array.from({ length: 1024 }, (_, i) => Math.sin(i) / 32);
  const restored = unpackVector(packVector(v));

  assert.equal(restored.length, 1024);
  for (let i = 0; i < 1024; i++) {
    assert.equal(restored[i], F32(v[i]));
  }
});

// 4096 bytes is exactly Node's Buffer pool threshold, so a 1024-float vector
// sits on the boundary where a Buffer may or may not be a pooled view. This is
// the case that breaks a naive `new Float32Array(buf.buffer, buf.byteOffset)`.
test("unpack is correct for both pooled and unpooled buffers", () => {
  for (const dims of [256, 512, 1024]) {
    const v = Array.from({ length: dims }, (_, i) => (i % 7) / 10);
    const restored = unpackVector(packVector(v));
    assert.equal(restored.length, dims, `dims ${dims}`);
    assert.equal(restored[1], F32(0.1), `dims ${dims} first values`);
    assert.equal(restored[dims - 1], F32(((dims - 1) % 7) / 10), `dims ${dims} last value`);
  }
});

test("cosine: identical vectors score 1", () => {
  const v = [0.6, 0.8, 0];
  assert.ok(Math.abs(cosine(v, v) - 1) < 1e-12);
});

test("cosine: orthogonal vectors score 0", () => {
  assert.equal(cosine([1, 0, 0], [0, 1, 0]), 0);
});

test("cosine: opposite vectors score -1", () => {
  assert.ok(Math.abs(cosine([1, 0], [-1, 0]) + 1) < 1e-12);
});

test("cosine: a zero vector scores 0 rather than NaN", () => {
  assert.equal(cosine([0, 0, 0], [1, 2, 3]), 0);
});

test("cosine: normalisation is applied, not assumed", () => {
  // Same direction, very different magnitudes. If the code short-circuited to a
  // raw dot product this would return 100, not 1.
  assert.ok(Math.abs(cosine([1, 0], [100, 0]) - 1) < 1e-12);
});

test("cosine: mismatched dimensions throw instead of ranking silently", () => {
  assert.throws(() => cosine([1, 2, 3], [1, 2]), /dimension mismatch/);
});

test("ranking survives the encode/decode boundary", () => {
  // The end-to-end property that matters: a query must still rank the closer
  // tool first after both vectors have been through the wire format.
  const query = [0.9, 0.1, 0.0];
  const near = packVector([0.88, 0.12, 0.01]);
  const far = packVector([-0.3, 0.5, 0.8]);

  assert.ok(cosine(query, unpackVector(near)) > cosine(query, unpackVector(far)));
});
