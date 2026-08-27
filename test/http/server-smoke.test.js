import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createAppServer } from "../../server.js";

let server;
let baseUrl;

before(async () => {
  server = createAppServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("serves the application shell", async () => {
  const response = await fetch(`${baseUrl}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/);
  assert.match(html, /Create Schematic Viewer/);
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
  const response = await fetch(`${baseUrl}/api/schematic`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: new Uint8Array([1, 2, 3])
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(typeof payload.error, "string");
  assert.ok(payload.error.length > 0);
});
