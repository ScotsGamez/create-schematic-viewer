import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAssetLibrary } from "../../src/library/asset-library.js";

const roots = [];
const summary = {
  textures: 14,
  models: 7,
  blockstates: 3,
  namespaces: ["create", "minecraft", "create"]
};

test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("imports jar and zip archives with safe, indexed metadata", async () => {
  const rootDir = await temporaryRoot();
  const library = createAssetLibrary({
    rootDir,
    clock: () => new Date("2026-08-26T12:34:56.000Z"),
    idFactory: () => "asset-1"
  });

  const asset = await library.importAsset({
    fileName: "Create <Factory> & extras.JAR",
    buffer: Buffer.from("archive bytes"),
    summary
  });

  assert.deepEqual(asset, {
    manifestVersion: 1,
    id: "asset-1",
    sequence: 1,
    fileName: "Create <Factory> & extras.JAR",
    displayName: "Create Factory extras",
    type: "jar",
    size: 13,
    digest: "sha256:cc9c340301ad4ba5e54aa24b442ff938d1ed84f7f32c4c5a73773c58af37bd1b",
    importedAt: "2026-08-26T12:34:56.000Z",
    summary: {
      textures: 14,
      models: 7,
      blockstates: 3,
      namespaces: ["create", "minecraft"]
    }
  });
  assert.deepEqual(await library.list(), [asset]);
  assert.deepEqual(await library.readAsset("asset-1"), Buffer.from("archive bytes"));
});

test("rejects unsafe filenames, unsupported types, invalid summaries, and unsafe ids", async () => {
  const rootDir = await temporaryRoot();
  let nextId = "safe-id";
  const library = createAssetLibrary({ rootDir, idFactory: () => nextId });
  const input = { fileName: "pack.jar", buffer: Buffer.from("bytes"), summary };

  await assert.rejects(library.importAsset({ ...input, fileName: "../pack.jar" }), /safe base name/);
  await assert.rejects(library.importAsset({ ...input, fileName: "pack.exe" }), /\.jar or \.zip/);
  await assert.rejects(library.importAsset({ ...input, fileName: ".zip" }), /include a name/);
  await assert.rejects(library.importAsset({ ...input, buffer: Buffer.alloc(0) }), /must not be empty/);
  await assert.rejects(
    library.importAsset({ ...input, summary: { ...summary, textures: -1 } }),
    /textures must be a non-negative integer/
  );
  await assert.rejects(
    library.importAsset({ ...input, summary: { ...summary, namespaces: ["Bad Namespace"] } }),
    /valid resource namespaces/
  );

  nextId = "../../escape";
  await assert.rejects(library.importAsset(input), /Asset id must contain only safe/);
  assert.deepEqual(await library.list(), []);
});

test("deduplicates repeated bytes and persists one immutable object", async () => {
  const rootDir = await temporaryRoot();
  let idCalls = 0;
  const library = createAssetLibrary({
    rootDir,
    idFactory: () => `asset-${++idCalls}`
  });
  const buffer = Buffer.from("same archive");

  const first = await library.importAsset({ fileName: "mod.jar", buffer, summary });
  const duplicate = await library.importAsset({ fileName: "renamed.zip", buffer, summary });

  assert.deepEqual(duplicate, first);
  assert.equal(idCalls, 1);
  assert.equal((await library.list()).length, 1);
  assert.equal((await readdir(path.join(rootDir, "objects"))).length, 1);
  assert.equal((await readdir(path.join(rootDir, "manifests"))).length, 1);
});

test("persists assets and deterministic import order across re-instantiation", async () => {
  const rootDir = await temporaryRoot();
  const ids = ["z-last-lexically", "a-first-lexically"];
  const first = createAssetLibrary({
    rootDir,
    clock: () => "2026-08-26T00:00:00.000Z",
    idFactory: () => ids.shift()
  });
  await first.importAsset({ fileName: "first.jar", buffer: Buffer.from("first"), summary });
  await first.importAsset({ fileName: "second.zip", buffer: Buffer.from("second"), summary });

  const second = createAssetLibrary({ rootDir });
  const persisted = await second.initialize();

  assert.deepEqual(persisted.map((asset) => asset.id), ["z-last-lexically", "a-first-lexically"]);
  assert.deepEqual(await second.readAsset("a-first-lexically"), Buffer.from("second"));
});

test("serializes concurrent imports into stable sequence order", async () => {
  const rootDir = await temporaryRoot();
  const ids = ["first", "second", "third"];
  const library = createAssetLibrary({ rootDir, idFactory: () => ids.shift() });

  await Promise.all([
    library.importAsset({ fileName: "first.jar", buffer: Buffer.from("1"), summary }),
    library.importAsset({ fileName: "second.jar", buffer: Buffer.from("2"), summary }),
    library.importAsset({ fileName: "third.zip", buffer: Buffer.from("3"), summary })
  ]);

  assert.deepEqual((await library.list()).map(({ id, sequence }) => ({ id, sequence })), [
    { id: "first", sequence: 1 },
    { id: "second", sequence: 2 },
    { id: "third", sequence: 3 }
  ]);
});

test("rehydrates healthy objects in order while isolating missing and corrupt objects", async () => {
  const rootDir = await temporaryRoot();
  const ids = ["healthy-first", "missing", "corrupt", "healthy-last"];
  const library = createAssetLibrary({ rootDir, idFactory: () => ids.shift() });
  for (const [name, bytes] of [
    ["first.jar", "first"],
    ["missing.jar", "missing"],
    ["corrupt.zip", "corrupt"],
    ["last.zip", "last"]
  ]) {
    await library.importAsset({ fileName: name, buffer: Buffer.from(bytes), summary });
  }
  const assets = await library.list();
  await unlink(objectPath(rootDir, assets[1]));
  await unlink(objectPath(rootDir, assets[2]));
  await writeFile(objectPath(rootDir, assets[2]), "tampered");

  await assert.rejects(library.readAsset("missing"), /object is missing/);
  await assert.rejects(library.readAsset("corrupt"), /failed its integrity check/);

  const calls = [];
  const result = await library.rehydrate((buffer, asset) => {
    calls.push(`${asset.id}:${buffer.toString("utf8")}`);
  });

  assert.deepEqual(calls, ["healthy-first:first", "healthy-last:last"]);
  assert.deepEqual(result.loaded.map((asset) => asset.id), ["healthy-first", "healthy-last"]);
  assert.deepEqual(result.failed.map(({ asset, error }) => ({ id: asset.id, error })), [
    { id: "missing", error: "Asset object is missing for missing." },
    { id: "corrupt", error: "Asset object failed its integrity check for corrupt." }
  ]);
});

test("rehydration isolates callback errors and continues in import order", async () => {
  const rootDir = await temporaryRoot();
  const ids = ["one", "two", "three"];
  const library = createAssetLibrary({ rootDir, idFactory: () => ids.shift() });
  for (const id of ["one", "two", "three"]) {
    await library.importAsset({ fileName: `${id}.jar`, buffer: Buffer.from(id), summary });
  }

  const calls = [];
  const result = await library.rehydrate((_buffer, asset) => {
    calls.push(asset.id);
    if (asset.id === "two") {
      throw new Error("indexer rejected archive");
    }
  });

  assert.deepEqual(calls, ["one", "two", "three"]);
  assert.deepEqual(result.loaded.map((asset) => asset.id), ["one", "three"]);
  assert.deepEqual(result.failed.map(({ asset, error }) => ({ id: asset.id, error })), [
    { id: "two", error: "indexer rejected archive" }
  ]);
});

test("manifests are durable JSON and temporary files are not left behind", async () => {
  const rootDir = await temporaryRoot();
  const library = createAssetLibrary({ rootDir, idFactory: () => "durable" });
  const asset = await library.importAsset({ fileName: "durable.jar", buffer: Buffer.from("durable"), summary });
  const manifestNames = await readdir(path.join(rootDir, "manifests"));
  const document = JSON.parse(await readFile(path.join(rootDir, "manifests", manifestNames[0]), "utf8"));

  assert.deepEqual(document, asset);
  assert.deepEqual(await readdir(path.join(rootDir, ".tmp")), []);
});

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "create-asset-library-"));
  roots.push(root);
  return root;
}

function objectPath(rootDir, asset) {
  return path.join(rootDir, "objects", asset.digest.slice("sha256:".length));
}
