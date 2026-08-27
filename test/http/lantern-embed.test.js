import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAppServer } from "../../server.js";
import { close, listen } from "../../test-support/http-server.js";

const MOUNT_PATH = "/schematics";

test("runs behind LANtern's prefix-stripping reverse proxy", async (context) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "schematic-viewer-embed-"));
  const tokenFile = path.join(dataDir, "admin-token");
  const trustedToken = "embed-proxy-test-token-with-at-least-32-bytes";
  await writeFile(tokenFile, trustedToken, { mode: 0o600 });
  const viewer = createAppServer({
    dataDir,
    libraryWriteMode: "trusted-proxy",
    libraryAdminTokenFile: tokenFile
  });
  await listen(viewer);
  const viewerAddress = viewer.address();
  const proxy = createPrefixProxy(viewerAddress.port);
  await listen(proxy);
  const proxyAddress = proxy.address();
  const baseUrl = `http://127.0.0.1:${proxyAddress.port}`;

  context.after(async () => {
    await close(proxy);
    await close(viewer);
    await rm(dataDir, { recursive: true, force: true });
  });

  const redirect = await fetch(`${baseUrl}${MOUNT_PATH}`, { redirect: "manual" });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), `${MOUNT_PATH}/`);

  const shellResponse = await fetch(`${baseUrl}${MOUNT_PATH}/`);
  const html = await shellResponse.text();
  assert.equal(shellResponse.status, 200);
  assert.match(shellResponse.headers.get("content-security-policy"), /frame-ancestors 'self'/);

  const documentUrl = `${baseUrl}${MOUNT_PATH}/`;
  const references = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(references.length >= 5);
  for (const reference of references) {
    if (reference.startsWith("#")) continue;
    assert.equal(reference.startsWith("./"), true, reference);
    assert.equal(new URL(reference, documentUrl).pathname.startsWith(`${MOUNT_PATH}/`), true, reference);
  }

  const bootstrapPaths = [
    "styles.css",
    "style.css",
    "app.js",
    "js/api-client.js",
    "js/library-client.js",
    "vendor/three/three.min.js",
    "vendor/three/OrbitControls.js"
  ];
  for (const bootstrapPath of bootstrapPaths) {
    const response = await fetch(`${baseUrl}${MOUNT_PATH}/${bootstrapPath}`);
    assert.equal(response.status, 200, bootstrapPath);
  }

  const [capabilitiesResponse, libraryResponse, spoofedCapabilitiesResponse, escapedApiResponse] = await Promise.all([
    fetch(`${baseUrl}${MOUNT_PATH}/api/v1/capabilities`),
    fetch(`${baseUrl}${MOUNT_PATH}/api/v1/library/schematics`),
    fetch(`${baseUrl}${MOUNT_PATH}/api/v1/capabilities`, {
      headers: { "x-lantern-schematic-admin": trustedToken }
    }),
    fetch(`${baseUrl}/api/v1/capabilities`)
  ]);
  assert.equal(capabilitiesResponse.status, 200);
  assert.equal((await capabilitiesResponse.json()).capabilities.libraryWrite, false);
  assert.equal(libraryResponse.status, 200);
  assert.equal((await libraryResponse.json()).capabilities.canWrite, false);
  assert.equal((await spoofedCapabilitiesResponse.json()).capabilities.libraryWrite, false);
  assert.equal(escapedApiResponse.status, 404);
});

function createPrefixProxy(viewerPort) {
  return http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === MOUNT_PATH) {
      response.writeHead(308, { location: `${MOUNT_PATH}/` });
      response.end();
      return;
    }
    if (!url.pathname.startsWith(`${MOUNT_PATH}/`)) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const upstreamPath = url.pathname.slice(MOUNT_PATH.length) || "/";
    const headers = { ...request.headers, host: `127.0.0.1:${viewerPort}` };
    delete headers["x-lantern-schematic-admin"];
    const upstream = http.request({
      hostname: "127.0.0.1",
      port: viewerPort,
      method: request.method,
      path: `${upstreamPath}${url.search}`,
      headers
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on("error", (error) => {
      response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      response.end(error.message);
    });
    request.pipe(upstream);
  });
}
