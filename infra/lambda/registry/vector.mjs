// Pure vector encoding — no AWS imports, so it is importable by tests without
// installing the SDK.
//
// The wire format is a Float32Array serialised to base64. 1024 floats is about
// 4 KB before encoding, far inside the 400 KB DynamoDB item limit, so a cold
// start needs one query rather than a join.
//
// This must stay byte-compatible with unpackVector in ../search/vector.mjs.
// infra/tests/vector.test.mjs asserts exactly that, because the two halves
// living in different deployment packages is precisely how they drift.

export const packVector = (v) =>
  Buffer.from(new Float32Array(v).buffer).toString("base64");
