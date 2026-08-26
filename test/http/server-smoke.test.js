import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { createAppServer, formatLogLine } from "../../server.js";

let server;
let baseUrl;
let dataDir;

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "schematic-viewer-http-"));
  server = createAppServer({ dataDir, libraryWriteEnabled: true });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(dataDir, { recursive: true, force: true });
});

test("serves the application shell", async () => {
  const response = await fetch(`${baseUrl}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/);
  assert.match(html, /Create Schematic Viewer/);
  assert.match(html, /\.\/vendor\/three\/three\.min\.js/);
  assert.match(html, /\.\/vendor\/three\/OrbitControls\.js/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("reports liveness and readiness", async () => {
  const [healthResponse, readinessResponse] = await Promise.all([
    fetch(`${baseUrl}/healthz`),
    fetch(`${baseUrl}/readyz`)
  ]);

  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), { status: "ok" });
  assert.equal(readinessResponse.status, 200);
  assert.deepEqual(await readinessResponse.json(), { status: "ready" });
});

test("formats runtime logs as one structured JSON line", () => {
  const line = formatLogLine("info", "test_event", { content: "first\nsecond" });
  const entry = JSON.parse(line);

  assert.equal(line.split("\n").length, 1);
  assert.equal(entry.level, "info");
  assert.equal(entry.event, "test_event");
  assert.equal(entry.content, "first\nsecond");
  assert.match(entry.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test("serves only the explicitly mapped local Three.js runtime files", async () => {
  const [threeResponse, controlsResponse, packageResponse] = await Promise.all([
    fetch(`${baseUrl}/vendor/three/three.min.js`),
    fetch(`${baseUrl}/vendor/three/OrbitControls.js`),
    fetch(`${baseUrl}/vendor/three/package.json`)
  ]);

  assert.equal(threeResponse.status, 200);
  assert.match(threeResponse.headers.get("content-type"), /^text\/javascript/);
  assert.match(await threeResponse.text(), /THREE/);
  assert.equal(controlsResponse.status, 200);
  assert.match(await controlsResponse.text(), /OrbitControls/);
  assert.equal(packageResponse.status, 404);
});

test("serves browser modules", async () => {
  const response = await fetch(`${baseUrl}/js/api-client.js`);
  const source = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/javascript/);
  assert.match(source, /export function createApiClient/);
});

test("reports asset-library state as JSON", async () => {
  const response = await fetch(`${baseUrl}/api/assets`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.textures, 0);
  assert.deepEqual(payload.packs, []);
});

test("returns a structured error for malformed schematic bytes", async () => {
  const errorLines = [];
  const originalError = console.error;
  console.error = (line) => errorLines.push(line);
  let response;
  try {
    response = await fetch(`${baseUrl}/api/schematic`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array([1, 2, 3])
    });
  } finally {
    console.error = originalError;
  }
  const payload = await response.json();
  const logEntry = JSON.parse(errorLines.at(-1));

  assert.equal(response.status, 400);
  assert.equal(typeof payload.error, "string");
  assert.ok(payload.error.length > 0);
  assert.equal("stack" in payload, false);
  assert.equal(logEntry.level, "error");
  assert.equal(logEntry.event, "request_failed");
  assert.equal(logEntry.status, 400);
});

test("supports the persistent schematic library lifecycle", async () => {
  const canonical = Uint8Array.of(10, 0, 0, 0);
  const createdResponse = await fetch(`${baseUrl}/api/v1/library/schematics`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-file-name": "tiny-factory.nbt",
      "x-title": "Tiny Factory",
      "x-library-metadata": encodeURIComponent(JSON.stringify({ tags: ["create", "starter"] }))
    },
    body: canonical
  });
  const created = await createdResponse.json();

  assert.equal(createdResponse.status, 201);
  assert.equal(created.title, "Tiny Factory");
  assert.equal(created.fileName, "tiny-factory.nbt");
  assert.equal(created.version, 1);

  const listResponse = await fetch(`${baseUrl}/api/v1/library/schematics?query=starter&includeTrashed=false`);
  const listed = await listResponse.json();
  assert.deepEqual(listed.items.map(({ id }) => id), [created.id]);

  const [contentResponse, previewResponse] = await Promise.all([
    fetch(`${baseUrl}/api/v1/library/schematics/${created.id}/content`),
    fetch(`${baseUrl}/api/v1/library/schematics/${created.id}/preview.svg`)
  ]);
  const content = new Uint8Array(await contentResponse.arrayBuffer());
  assert.deepEqual([...content.slice(0, 2)], [0x1f, 0x8b]);
  assert.match(contentResponse.headers.get("content-disposition"), /tiny-factory\.nbt/);
  assert.equal(previewResponse.status, 200);
  assert.match(previewResponse.headers.get("content-type"), /^image\/svg\+xml/);
  assert.match(await previewResponse.text(), /Tiny Factory/);

  const versionResponse = await fetch(`${baseUrl}/api/v1/library/schematics/${created.id}/versions`, {
    method: "POST",
    headers: {
      "x-file-name": "tiny-factory-v2.nbt",
      "x-title": "Tiny Factory Updated"
    },
    body: canonical
  });
  assert.equal(versionResponse.status, 201);
  assert.equal((await versionResponse.json()).version, 2);
  const detail = await (await fetch(`${baseUrl}/api/v1/library/schematics/${created.id}`)).json();
  assert.deepEqual(detail.versions.map(({ version }) => version), [1, 2]);
  assert.notEqual(detail.versions[0].canonical.sha256, detail.versions[0].original.sha256);

  const trashResponse = await fetch(`${baseUrl}/api/v1/library/schematics/${created.id}`, { method: "DELETE" });
  assert.equal(trashResponse.status, 200);
  assert.equal((await trashResponse.json()).trashed, true);
  assert.equal((await (await fetch(`${baseUrl}/api/v1/library/schematics`)).json()).items.length, 0);

  const restoreResponse = await fetch(`${baseUrl}/api/v1/library/schematics/${created.id}/restore`, { method: "POST" });
  assert.equal(restoreResponse.status, 200);
  assert.equal((await restoreResponse.json()).trashed, false);
});

test("rejects non-canonical schematic formats at the library boundary", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await fetch(`${baseUrl}/api/v1/library/schematics`, {
      method: "POST",
      headers: { "x-file-name": "source.schem" },
      body: Uint8Array.of(1, 2, 3)
    });
    assert.equal(response.status, 415);
    assert.match((await response.json()).error, /Convert \.schem or \.litematic files first/);
  } finally {
    console.error = originalError;
  }
});

test("keeps shared-library mutations disabled by default", async (context) => {
  const readOnlyDataDir = await mkdtemp(path.join(os.tmpdir(), "schematic-viewer-read-only-"));
  const readOnlyServer = createAppServer({ dataDir: readOnlyDataDir });
  context.after(async () => {
    await new Promise((resolve, reject) => readOnlyServer.close((error) => error ? reject(error) : resolve()));
    await rm(readOnlyDataDir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    readOnlyServer.once("error", reject);
    readOnlyServer.listen(0, "127.0.0.1", resolve);
  });
  const address = readOnlyServer.address();
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/library/schematics`, {
      method: "POST",
      headers: { "x-file-name": "blocked.nbt" },
      body: Uint8Array.of(10, 0, 0, 0)
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /changes are disabled/);
  } finally {
    console.error = originalError;
  }
});
