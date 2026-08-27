import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLibraryBackup, restoreLibraryBackup } from "../../src/library/backup.js";

test("backup and restore copy a library without overwriting a target", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "schematic-library-backup-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const backup = join(root, "backup");
  const restored = join(root, "restored");
  await mkdir(join(source, "schematics", "objects"), { recursive: true });
  await writeFile(join(source, "schematics", "objects", "fixture.nbt"), "fixture");

  const created = await createLibraryBackup({
    sourceDir: source,
    destinationDir: backup,
    clock: () => new Date("2026-01-02T03:04:05.000Z")
  });
  const recovered = await restoreLibraryBackup({ backupDir: backup, targetDir: restored });

  assert.equal(created.createdAt, "2026-01-02T03:04:05.000Z");
  assert.deepEqual(recovered, created);
  assert.equal(await readFile(join(restored, "schematics", "objects", "fixture.nbt"), "utf8"), "fixture");
  await assert.rejects(
    restoreLibraryBackup({ backupDir: backup, targetDir: restored }),
    /already exists/
  );
});

test("backup refuses nested trees and restore requires a valid marker", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "schematic-library-backup-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const invalidBackup = join(root, "invalid-backup");
  await mkdir(source, { recursive: true });
  await mkdir(invalidBackup, { recursive: true });

  await assert.rejects(
    createLibraryBackup({ sourceDir: source, destinationDir: join(source, "backup") }),
    /separate directory trees/
  );
  await assert.rejects(
    restoreLibraryBackup({ backupDir: invalidBackup, targetDir: join(root, "restored") }),
    /manifest is missing or invalid/
  );
});
