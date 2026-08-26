import assert from "node:assert/strict";
import test from "node:test";

import { createApiClient, decodeHeaderLog } from "../../public/js/api-client.js";

test("parseSchematic posts binary data to the configured API base", async () => {
  const calls = [];
  const client = createApiClient({
    baseUrl: "/schematics/api",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ size: { x: 1, y: 2, z: 3 } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  const bytes = new Uint8Array([1, 2, 3]);

  const result = await client.parseSchematic(bytes);

  assert.deepEqual(result.size, { x: 1, y: 2, z: 3 });
  assert.equal(calls[0].url, "/schematics/api/schematic");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.body, bytes);
});

test("API errors preserve a server JSON error message", async () => {
  const client = createApiClient({
    fetchImpl: async () => new Response(JSON.stringify({ error: "invalid schematic" }), { status: 422 })
  });

  await assert.rejects(() => client.parseSchematic(new Uint8Array()), /invalid schematic/);
});

test("convert returns response metadata and output", async () => {
  const client = createApiClient({
    fetchImpl: async () => new Response(new Uint8Array([31, 139, 8]), {
      status: 200,
      headers: {
        "x-converter-output": "nbt",
        "x-split-mode-used": "single",
        "x-split-max-kb-used": "0",
        "x-converter-log": encodeURIComponent("converted successfully")
      }
    })
  });

  const result = await client.convert({
    fileName: "factory.litematic",
    bytes: new Uint8Array([1]),
    splitMode: "single",
    splitMaxKb: 512
  });

  assert.equal(result.outputKind, "nbt");
  assert.equal(result.modeUsed, "single");
  assert.equal(result.log, "converted successfully");
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), new Uint8Array([31, 139, 8]));
});

test("decodeHeaderLog tolerates malformed encoding", () => {
  assert.equal(decodeHeaderLog("bad%value"), "bad%value");
});
