import assert from "node:assert/strict";
import test from "node:test";

import { createLibraryClient } from "../../public/js/library-client.js";

function recordingClient(responseFactory, baseUrl = "/schematics/api/v1/") {
  const calls = [];
  const client = createLibraryClient({
    baseUrl,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return responseFactory(url, options);
    }
  });
  return { calls, client };
}

test("listSchematics URL-encodes search and trash filters", async () => {
  const { calls, client } = recordingClient(async () => new Response(JSON.stringify({
    items: [{ id: "factory" }]
  }), { status: 200, headers: { "content-type": "application/json" } }));

  const result = await client.listSchematics({ query: "brass & stone/鉄", includeTrashed: true });

  assert.deepEqual(result.items, [{ id: "factory" }]);
  assert.equal(
    calls[0].url,
    "/schematics/api/v1/library/schematics?query=brass+%26+stone%2F%E9%89%84&includeTrashed=true"
  );
  assert.equal(calls[0].options, undefined);
});

test("listSchematics normalizes a missing items collection", async () => {
  const { client } = recordingClient(async () => new Response("{}", {
    status: 200,
    headers: { "content-type": "application/json" }
  }));

  assert.deepEqual(await client.listSchematics(), { items: [] });
});

test("importSchematic posts bytes and encoded metadata headers", async () => {
  const { calls, client } = recordingClient(async () => new Response(JSON.stringify({ id: "sha256-id" }), {
    status: 201,
    headers: { "content-type": "application/json" }
  }));
  const bytes = new Uint8Array([10, 20, 30]);
  const metadata = { author: "Builder & Co", tags: ["factory", "鉄"] };

  const result = await client.importSchematic({
    bytes,
    fileName: "brass factory.nbt",
    title: "Brass Factory",
    metadata
  });

  assert.deepEqual(result, { id: "sha256-id" });
  assert.equal(calls[0].url, "/schematics/api/v1/library/schematics");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.body, bytes);
  assert.equal(calls[0].options.headers["x-file-name"], "brass factory.nbt");
  assert.equal(calls[0].options.headers["x-title"], "Brass Factory");
  assert.deepEqual(
    JSON.parse(decodeURIComponent(calls[0].options.headers["x-library-metadata"])),
    metadata
  );
});

test("importSchematicVersion appends through the version endpoint", async () => {
  const { calls, client } = recordingClient(async () => new Response(JSON.stringify({ version: 2 }), {
    status: 201,
    headers: { "content-type": "application/json" }
  }));

  assert.deepEqual(await client.importSchematicVersion("factory one", {
    bytes: Uint8Array.of(10, 0, 0, 0),
    fileName: "factory-v2.nbt",
    title: "Factory v2"
  }), { version: 2 });
  assert.equal(calls[0].url, "/schematics/api/v1/library/schematics/factory%20one/versions");
  assert.equal(calls[0].options.method, "POST");
});

test("getContent returns the canonical NBT blob and encodes the id", async () => {
  const canonical = new Uint8Array([31, 139, 8, 0]);
  const { calls, client } = recordingClient(async () => new Response(canonical, {
    status: 200,
    headers: { "content-type": "application/octet-stream" }
  }));

  const blob = await client.getContent("sha/with spaces");

  assert.equal(calls[0].url, "/schematics/api/v1/library/schematics/sha%2Fwith%20spaces/content");
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), canonical);
});

test("getSchematic and versioned content expose history", async () => {
  const { calls, client } = recordingClient(async (url) => url.endsWith("?version=2")
    ? new Response(Uint8Array.of(31, 139), { status: 200 })
    : new Response(JSON.stringify({ id: "factory", versions: [{ version: 1 }, { version: 2 }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      }));

  assert.equal((await client.getSchematic("factory")).versions.length, 2);
  assert.deepEqual(new Uint8Array(await (await client.getContent("factory", 2)).arrayBuffer()), Uint8Array.of(31, 139));
  assert.deepEqual(calls.map(({ url }) => url), [
    "/schematics/api/v1/library/schematics/factory",
    "/schematics/api/v1/library/schematics/factory/content?version=2"
  ]);
});

test("trashSchematic and restoreSchematic use their lifecycle endpoints", async () => {
  const { calls, client } = recordingClient(async (_url, options) => new Response(
    options.method === "DELETE" ? JSON.stringify({ status: "trashed" }) : null,
    {
      status: options.method === "DELETE" ? 200 : 204,
      headers: options.method === "DELETE" ? { "content-type": "application/json" } : undefined
    }
  ));

  assert.deepEqual(await client.trashSchematic("build #1"), { status: "trashed" });
  assert.equal(await client.restoreSchematic("build #1"), null);
  assert.deepEqual(calls.map(({ url, options }) => [url, options.method]), [
    ["/schematics/api/v1/library/schematics/build%20%231", "DELETE"],
    ["/schematics/api/v1/library/schematics/build%20%231/restore", "POST"]
  ]);
});

test("library operations surface server errors", async () => {
  const { client } = recordingClient(async () => new Response(
    JSON.stringify({ error: "schematic is already in the library" }),
    { status: 409, headers: { "content-type": "application/json" } }
  ));

  await assert.rejects(
    () => client.importSchematic({ bytes: new Uint8Array(), fileName: "duplicate.nbt" }),
    /schematic is already in the library/
  );
  await assert.rejects(() => client.getContent("missing"), /schematic is already in the library/);
  await assert.rejects(() => client.trashSchematic("missing"), /schematic is already in the library/);
  await assert.rejects(() => client.restoreSchematic("missing"), /schematic is already in the library/);
});

test("previewUrl uses the configured API base and encoded id", () => {
  const client = createLibraryClient({ baseUrl: "/schematics/api/v1" });
  assert.equal(
    client.previewUrl("brass & iron"),
    "/schematics/api/v1/library/schematics/brass%20%26%20iron/preview.svg"
  );
});
