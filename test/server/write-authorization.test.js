import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWriteAuthorizer } from "../../src/server/write-authorization.js";

const roots = [];

test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("keeps persistent writes disabled by default", () => {
  const authorizer = createWriteAuthorizer();

  assert.equal(authorizer.mode, "disabled");
  assert.equal(authorizer.canWrite({ headers: {} }), false);
});

test("preserves the local compatibility mode", () => {
  const authorizer = createWriteAuthorizer({ legacyWriteEnabled: true });

  assert.equal(authorizer.mode, "local");
  assert.equal(authorizer.canWrite({ headers: {} }), true);
});

test("authorizes trusted proxy requests with a file-mounted token", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "schematic-viewer-auth-"));
  roots.push(root);
  const tokenFile = path.join(root, "admin-token");
  const token = "gate-four-test-token-with-at-least-32-bytes";
  await writeFile(tokenFile, `${token}\n`, { mode: 0o600 });

  const authorizer = createWriteAuthorizer({ mode: "trusted-proxy", tokenFile });

  assert.equal(authorizer.mode, "trusted-proxy");
  assert.equal(authorizer.canWrite({ headers: {} }), false);
  assert.equal(authorizer.canWrite({ headers: { "x-lantern-schematic-admin": "wrong" } }), false);
  assert.equal(authorizer.canWrite({ headers: { "x-lantern-schematic-admin": token } }), true);
});

test("fails closed for incomplete trusted-proxy configuration", async () => {
  assert.throws(
    () => createWriteAuthorizer({ mode: "trusted-proxy" }),
    /TOKEN_FILE is required/
  );

  const root = await mkdtemp(path.join(os.tmpdir(), "schematic-viewer-auth-short-"));
  roots.push(root);
  const tokenFile = path.join(root, "admin-token");
  await writeFile(tokenFile, "too-short");
  assert.throws(
    () => createWriteAuthorizer({ tokenFile, legacyWriteEnabled: true }),
    /only valid when LIBRARY_WRITE_MODE=trusted-proxy/
  );
  assert.throws(
    () => createWriteAuthorizer({ mode: "trusted-proxy", tokenFile }),
    /at least 32 bytes/
  );
  assert.throws(() => createWriteAuthorizer({ mode: "unknown" }), /must be one of/);
});
