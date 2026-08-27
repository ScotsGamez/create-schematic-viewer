import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const BACKUP_MANIFEST = "backup-manifest.json";
const FORMAT_VERSION = 1;

export async function createLibraryBackup({ sourceDir, destinationDir, clock = () => new Date() }) {
  const source = resolveRequiredPath(sourceDir, "sourceDir");
  const destination = resolveRequiredPath(destinationDir, "destinationDir");
  assertSeparateTrees(source, destination);
  await requireDirectory(source, "Library data directory");
  await requireRegularTree(source, "Library data directory");
  await requireMissing(destination, "Backup destination");

  const temporary = temporarySibling(destination);
  await mkdir(dirname(destination), { recursive: true });
  try {
    await cp(source, temporary, { recursive: true, force: false, errorOnExist: true });
    const manifest = {
      format: "create-schematic-viewer-library-backup",
      version: FORMAT_VERSION,
      createdAt: clock().toISOString()
    };
    await writeFile(join(temporary, BACKUP_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    await rename(temporary, destination);
    return manifest;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function restoreLibraryBackup({ backupDir, targetDir }) {
  const backup = resolveRequiredPath(backupDir, "backupDir");
  const target = resolveRequiredPath(targetDir, "targetDir");
  assertSeparateTrees(backup, target);
  await requireDirectory(backup, "Backup directory");
  await requireRegularTree(backup, "Backup directory");
  await requireMissing(target, "Restore target");

  const manifest = await readBackupManifest(backup);
  const temporary = temporarySibling(target);
  await mkdir(dirname(target), { recursive: true });
  try {
    await cp(backup, temporary, { recursive: true, force: false, errorOnExist: true });
    await unlink(join(temporary, BACKUP_MANIFEST));
    await rename(temporary, target);
    return manifest;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function readBackupManifest(backupDir) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(backupDir, BACKUP_MANIFEST), "utf8"));
  } catch {
    throw new Error("Backup manifest is missing or invalid.");
  }
  if (manifest?.format !== "create-schematic-viewer-library-backup" || manifest.version !== FORMAT_VERSION) {
    throw new Error("Backup format is not supported.");
  }
  return manifest;
}

function resolveRequiredPath(value, name) {
  if (!value || !String(value).trim()) {
    throw new Error(`${name} is required.`);
  }
  return resolve(String(value));
}

function assertSeparateTrees(first, second) {
  const forward = relative(first, second);
  const reverse = relative(second, first);
  if (forward === "" || isInside(forward) || isInside(reverse)) {
    throw new Error("Backup source and destination must be separate directory trees.");
  }
}

function isInside(relativePath) {
  return relativePath !== "" && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}

async function requireDirectory(path, label) {
  try {
    const details = await lstat(path);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error(`${label} must be a real directory.`);
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${label} does not exist.`);
    }
    throw error;
  }
}

async function requireMissing(path, label) {
  try {
    await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} already exists; refusing to overwrite it.`);
}

async function requireRegularTree(path, label) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      await requireRegularTree(child, label);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`${label} contains an unsupported filesystem entry.`);
    }
  }
}

function temporarySibling(path) {
  return join(dirname(path), `.${basename(path)}.tmp-${randomUUID()}`);
}
