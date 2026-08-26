import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSchematicLibrary } from "../../src/library/schematic-library.js";

const VALIDATED = Object.freeze({
  size: { x: 7, y: 8, z: 9 },
  totalBlocks: 1234,
  visibleBlocks: 1200,
  dataVersion: 3953,
  warnings: []
});

test("deduplicates canonical, original, and deterministic preview objects", async (t) => {
  const rootDir = await temporaryLibrary(t);
  const ids = iterator(["first", "second"]);
  const library = createSchematicLibrary({ rootDir, idFactory: ids, validateCanonical: validate });
  const canonical = Buffer.from("canonical-nbt");
  const original = Buffer.from("original-upload");
  const input = {
    canonical,
    original,
    metadata: { title: "Factory", tags: ["Create"] },
    provenance: { sourceFilename: "factory.schem" }
  };

  const first = await library.importVersion(input);
  const second = await library.importVersion(input);

  assert.equal(first.versions[0].canonical.sha256, second.versions[0].canonical.sha256);
  assert.equal(first.versions[0].original.sha256, second.versions[0].original.sha256);
  assert.equal(first.versions[0].preview.sha256, second.versions[0].preview.sha256);
  assert.equal((await objectFiles(path.join(rootDir, "objects", "canonical"))).length, 1);
  assert.equal((await objectFiles(path.join(rootDir, "objects", "original"))).length, 1);
  assert.equal((await objectFiles(path.join(rootDir, "objects", "preview"))).length, 1);
  assert.deepEqual(await library.readCanonical("first"), canonical);
  assert.deepEqual(await library.readOriginal("first"), original);
});

test("persists entries across library re-instantiation", async (t) => {
  const rootDir = await temporaryLibrary(t);
  const first = createSchematicLibrary({ rootDir, idFactory: () => "persistent", validateCanonical: validate });
  await first.importVersion({
    canonical: Buffer.from("one"),
    metadata: { title: "Persistent Factory" }
  });

  const reopened = createSchematicLibrary({ rootDir, validateCanonical: validate });
  const entry = await reopened.get("persistent");

  assert.equal(entry.id, "persistent");
  assert.equal(entry.metadata.title, "Persistent Factory");
  assert.deepEqual(await reopened.readCanonical("persistent"), Buffer.from("one"));
  assert.deepEqual((await reopened.list()).map(({ id }) => id), ["persistent"]);
});

test("appends immutable version records and reads a selected version", async (t) => {
  const rootDir = await temporaryLibrary(t);
  const timestamps = iterator(["2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z"]);
  const library = createSchematicLibrary({
    rootDir,
    clock: timestamps,
    idFactory: () => "versioned",
    validateCanonical: validate
  });
  const original = await library.importVersion({
    canonical: Buffer.from("version-one"),
    metadata: { title: "First title" }
  });
  const updated = await library.importVersion({
    entryId: "versioned",
    canonical: Buffer.from("version-two"),
    metadata: { title: "Second title" }
  });

  assert.equal(updated.id, original.id);
  assert.equal(updated.createdAt, original.createdAt);
  assert.equal(updated.updatedAt, "2026-01-02T00:00:00.000Z");
  assert.equal(updated.metadata.title, "Second title");
  assert.deepEqual(updated.versions.map(({ version, metadata }) => [version, metadata.title]), [
    [1, "First title"],
    [2, "Second title"]
  ]);
  assert.deepEqual(await library.readCanonical("versioned", 1), Buffer.from("version-one"));
  assert.deepEqual(await library.readCanonical("versioned"), Buffer.from("version-two"));
  await assert.rejects(() => library.readCanonical("versioned", 999), /Version '999' was not found/);
});

test("soft-deletes and restores entries without deleting stored bytes", async (t) => {
  const rootDir = await temporaryLibrary(t);
  const library = createSchematicLibrary({
    rootDir,
    clock: () => "2026-02-03T04:05:06.000Z",
    idFactory: () => "recoverable",
    validateCanonical: validate
  });
  await library.importVersion({ canonical: Buffer.from("keep-me") });

  const trashed = await library.trash("recoverable");

  assert.equal(trashed.trashedAt, "2026-02-03T04:05:06.000Z");
  assert.deepEqual(await library.list(), []);
  assert.deepEqual((await library.list({ includeTrashed: true })).map(({ id }) => id), ["recoverable"]);
  assert.deepEqual(await library.readCanonical("recoverable"), Buffer.from("keep-me"));

  const restored = await library.restore("recoverable");
  assert.equal(restored.trashedAt, null);
  assert.deepEqual((await library.list()).map(({ id }) => id), ["recoverable"]);
});

test("normalizes metadata and provenance without using source paths for storage", async (t) => {
  const rootDir = await temporaryLibrary(t);
  const library = createSchematicLibrary({ rootDir, idFactory: () => "normalized", validateCanonical: validate });

  const entry = await library.importVersion({
    canonical: Buffer.from("metadata"),
    metadata: {
      title: "  Copper   Factory  ",
      description: "  Compact\n production   line ",
      tags: [" Create ", "Factory", "create"],
      sourceFilename: "ignored.schem"
    },
    provenance: {
      sourceFilename: "../../uploads/actual build.schem",
      sourceUrl: " https://example.test/schematics/42 ",
      author: "  Builder  ",
      license: " MIT "
    }
  });

  assert.deepEqual(entry.metadata, {
    title: "Copper Factory",
    description: "Compact production line",
    tags: ["create", "factory"],
    provenance: {
      sourceFilename: "actual build.schem",
      sourceUrl: "https://example.test/schematics/42",
      author: "Builder",
      license: "MIT"
    }
  });
  assert.deepEqual(entry.versions[0].schematic, VALIDATED);
  assert.equal((await objectFiles(rootDir)).some((file) => file.includes("actual build")), false);
});

test("generates deterministic SVG previews and escapes all user text", async (t) => {
  const rootDir = await temporaryLibrary(t);
  const library = createSchematicLibrary({
    rootDir,
    idFactory: () => "escaped",
    validateCanonical: () => ({
      ...VALIDATED,
      warnings: ["Unknown Create block state"],
      blocks: [
        { pos: { x: 1, y: 2, z: 3 }, label: "create:shaft[axis=y]" },
        { pos: { x: 4, y: 5, z: 6 }, label: "minecraft:stone" }
      ]
    })
  });
  await library.importVersion({
    canonical: Buffer.from("svg"),
    metadata: {
      title: `<script>alert("x")</script> & factory`,
      description: `owner's <build>`,
      tags: [`red & blue`]
    }
  });

  const svg = (await library.readPreview("escaped")).toString("utf8");

  assert.match(svg, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; factory/);
  assert.match(svg, /owner&apos;s &lt;build&gt;/);
  assert.match(svg, /red &amp; blue/);
  assert.match(svg, /7 × 8 × 9/);
  assert.match(svg, /1,200 visible blocks/);
  assert.match(svg, /<polygon points=/);
  assert.doesNotMatch(svg, /<script>/);
  assert.deepEqual((await library.get("escaped")).versions[0].schematic.warnings, ["Unknown Create block state"]);
});

test("rejects traversal IDs, unsafe provenance URLs, and unvalidated imports", async (t) => {
  const rootDir = await temporaryLibrary(t);
  const library = createSchematicLibrary({ rootDir, idFactory: () => "safe", validateCanonical: validate });

  await assert.rejects(
    () => library.importVersion({ entryId: "../escape", canonical: Buffer.from("x") }),
    /entryId must contain only/
  );
  await assert.rejects(() => library.get("..\\escape"), /entryId must contain only/);
  await assert.rejects(
    () => library.importVersion({
      canonical: Buffer.from("x"),
      provenance: { sourceUrl: "file:///etc/passwd" }
    }),
    /sourceUrl must be a valid HTTP or HTTPS URL/
  );

  const noValidator = createSchematicLibrary({ rootDir: path.join(rootDir, "unvalidated") });
  await assert.rejects(
    () => noValidator.importVersion({ canonical: Buffer.from("x") }),
    /validateCanonical function is required/
  );
  assert.equal(await library.get("safe"), null);
});

test("serializes concurrent version imports without losing history", async (t) => {
  const rootDir = await temporaryLibrary(t);
  const library = createSchematicLibrary({ rootDir, validateCanonical: validate });
  await library.importVersion({
    entryId: "concurrent",
    canonical: Buffer.from("initial"),
    metadata: { title: "Initial" }
  });

  await Promise.all([
    library.importVersion({ entryId: "concurrent", canonical: Buffer.from("second"), metadata: { title: "Second" } }),
    library.importVersion({ entryId: "concurrent", canonical: Buffer.from("third"), metadata: { title: "Third" } })
  ]);

  const entry = await library.get("concurrent");
  assert.deepEqual(entry.versions.map(({ version }) => version), [1, 2, 3]);
  assert.deepEqual(entry.versions.map(({ metadata }) => metadata.title), ["Initial", "Second", "Third"]);
});

async function temporaryLibrary(t) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "schematic-library-test-"));
  t.after(async () => {
    assert.equal(path.dirname(rootDir), os.tmpdir());
    assert.match(path.basename(rootDir), /^schematic-library-test-/);
    await rm(rootDir, { recursive: true, force: true });
  });
  return rootDir;
}

function validate(bytes) {
  assert.ok(Buffer.isBuffer(bytes));
  assert.ok(bytes.length > 0);
  return VALIDATED;
}

function iterator(values) {
  let index = 0;
  return () => {
    if (index >= values.length) {
      throw new Error("Test iterator exhausted.");
    }
    return values[index++];
  };
}

async function objectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await objectFiles(candidate));
    } else {
      files.push(candidate);
    }
  }
  return files;
}
