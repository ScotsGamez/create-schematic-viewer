import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createAppServer, formatLogLine } from "../../server.js";

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
