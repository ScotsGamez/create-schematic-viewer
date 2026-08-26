import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { canonicalizeNbt, parseNbt } from "../../src/nbt.js";

test("canonicalizes raw and gzipped NBT into identical deterministic gzip bytes", () => {
  const raw = Buffer.from([10, 0, 0, 0]);
  const fromRaw = canonicalizeNbt(raw);
  const fromGzip = canonicalizeNbt(gzipSync(raw));

  assert.deepEqual(fromRaw, fromGzip);
  assert.deepEqual([...fromRaw.subarray(0, 2)], [0x1f, 0x8b]);
  assert.deepEqual(parseNbt(fromRaw), { name: "", value: {} });
});

test("refuses to canonicalize malformed NBT", () => {
  assert.throws(() => canonicalizeNbt(Buffer.from([1, 2, 3])), /Expected a root compound tag/);
});
