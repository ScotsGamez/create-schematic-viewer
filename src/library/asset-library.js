import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";

const MANIFEST_VERSION = 1;
const DIGEST_PATTERN = /^sha256:([a-f0-9]{64})$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const NAMESPACE_PATTERN = /^[a-z0-9_.-]+$/;

/**
 * Create a persistent asset archive library.
 *
 * Archives are indexed before they cross this seam. The supplied summary is
 * persisted beside an immutable, content-addressed copy of the archive.
 *
 * @param {{
 *   rootDir: string,
 *   clock?: () => Date | string | number,
 *   idFactory?: () => string
 * }} options
 */
export function createAssetLibrary({
  rootDir,
  clock = () => new Date(),
  idFactory = () => randomUUID()
}) {
  if (typeof rootDir !== "string" || !rootDir.trim()) {
    throw new TypeError("Asset library rootDir must be a non-empty path.");
  }
  if (typeof clock !== "function" || typeof idFactory !== "function") {
    throw new TypeError("Asset library clock and idFactory must be functions.");
  }

  const root = path.resolve(rootDir);
  const objectsDir = path.join(root, "objects");
  const manifestsDir = path.join(root, "manifests");
  const temporaryDir = path.join(root, ".tmp");
  /** @type {Map<string, AssetManifest>} */
  let assetsById = new Map();
  /** @type {Map<string, AssetManifest>} */
  let assetsByDigest = new Map();
  let nextSequence = 1;
  /** @type {Promise<AssetManifest[]> | null} */
  let initialization = null;
  let writeQueue = Promise.resolve();

  async function initialize() {
    initialization ||= loadLibrary();
    await initialization;
    return listSnapshot();
  }

  async function list() {
    await initialize();
    return listSnapshot();
  }

  /**
   * @param {{fileName: string, buffer: Buffer | Uint8Array, summary: AssetSummary}} input
   */
  function importAsset(input) {
    return serialize(async () => {
      await initialize();
      const file = validateFile(input?.fileName);
      const buffer = validateBuffer(input?.buffer);
      const summary = validateSummary(input?.summary);
      const digestHex = createHash("sha256").update(buffer).digest("hex");
      const digest = `sha256:${digestHex}`;
      const duplicate = assetsByDigest.get(digest);

      if (duplicate) {
        await readAndVerifyObject(duplicate);
        return cloneManifest(duplicate);
      }

      const id = validateId(idFactory());
      if (assetsById.has(id)) {
        throw new Error(`Asset id already exists: ${id}`);
      }

      const importedAt = normalizeTimestamp(clock());
      /** @type {AssetManifest} */
      const manifest = {
        manifestVersion: MANIFEST_VERSION,
        id,
        sequence: nextSequence,
        fileName: file.fileName,
        displayName: file.displayName,
        type: file.type,
        size: buffer.byteLength,
        digest,
        importedAt,
        summary
      };

      await persistObject(digestHex, buffer);
      await persistManifest(manifest);

      assetsById.set(id, manifest);
      assetsByDigest.set(digest, manifest);
      nextSequence += 1;
      return cloneManifest(manifest);
    });
  }

  async function readAsset(id) {
    await initialize();
    const safeId = validateId(id);
    const asset = assetsById.get(safeId);
    if (!asset) {
      throw new Error(`Asset not found: ${safeId}`);
    }
    return readAndVerifyObject(asset);
  }

  /**
   * Load every healthy archive in its original import order.
   *
   * Integrity failures and callback failures are isolated and returned to the
   * caller so one bad asset cannot prevent later assets from loading.
   *
   * @param {(buffer: Buffer, asset: AssetManifest) => unknown | Promise<unknown>} callback
   */
  async function rehydrate(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("Asset library rehydrate callback must be a function.");
    }
    const assets = await list();
    const loaded = [];
    const failed = [];

    for (const asset of assets) {
      try {
        const buffer = await readAndVerifyObject(asset);
        await callback(buffer, cloneManifest(asset));
        loaded.push(cloneManifest(asset));
      } catch (error) {
        failed.push({
          asset: cloneManifest(asset),
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return { loaded, failed };
  }

  async function loadLibrary() {
    await Promise.all([
      mkdir(objectsDir, { recursive: true }),
      mkdir(manifestsDir, { recursive: true }),
      mkdir(temporaryDir, { recursive: true })
    ]);

    const names = (await readdir(manifestsDir))
      .filter((name) => name.endsWith(".json"))
      .sort((left, right) => left.localeCompare(right));
    const manifests = [];
    for (const name of names) {
      const filePath = safeChildPath(manifestsDir, name);
      const document = JSON.parse(await readFile(filePath, "utf8"));
      manifests.push(validateManifest(document, name));
    }
    manifests.sort(compareManifests);

    const loadedById = new Map();
    const loadedByDigest = new Map();
    for (const manifest of manifests) {
      if (loadedById.has(manifest.id)) {
        throw new Error(`Duplicate asset id in manifests: ${manifest.id}`);
      }
      if (loadedByDigest.has(manifest.digest)) {
        throw new Error(`Duplicate asset digest in manifests: ${manifest.digest}`);
      }
      loadedById.set(manifest.id, manifest);
      loadedByDigest.set(manifest.digest, manifest);
    }

    assetsById = loadedById;
    assetsByDigest = loadedByDigest;
    nextSequence = manifests.reduce((maximum, asset) => Math.max(maximum, asset.sequence), 0) + 1;
    return listSnapshot();
  }

  function listSnapshot() {
    return [...assetsById.values()].sort(compareManifests).map(cloneManifest);
  }

  async function persistObject(digestHex, buffer) {
    const target = safeChildPath(objectsDir, digestHex);
    const temporary = temporaryPath(`object-${digestHex}`);
    await writeFile(temporary, buffer, { flag: "wx", mode: 0o444 });
    try {
      await link(temporary, target);
    } catch (error) {
      if (!isAlreadyExists(error)) {
        throw error;
      }
      await verifyObjectFile(target, buffer.byteLength, `sha256:${digestHex}`);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async function persistManifest(manifest) {
    const sequence = String(manifest.sequence).padStart(12, "0");
    const target = safeChildPath(manifestsDir, `${sequence}-${manifest.id}.json`);
    const temporary = temporaryPath(`manifest-${manifest.id}`);
    const document = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(temporary, document, { encoding: "utf8", flag: "wx", mode: 0o444 });
    try {
      await link(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async function readAndVerifyObject(asset) {
    const match = DIGEST_PATTERN.exec(asset.digest);
    if (!match) {
      throw new Error(`Asset ${asset.id} has an invalid digest.`);
    }
    const objectPath = safeChildPath(objectsDir, match[1]);
    return verifyObjectFile(objectPath, asset.size, asset.digest, asset.id);
  }

  function temporaryPath(label) {
    return safeChildPath(temporaryDir, `${label}-${randomUUID()}.tmp`);
  }

  function serialize(operation) {
    const result = writeQueue.then(operation);
    writeQueue = result.catch(() => undefined);
    return result;
  }

  return { initialize, list, importAsset, readAsset, rehydrate };
}

async function verifyObjectFile(filePath, expectedSize, expectedDigest, assetId = expectedDigest) {
  let buffer;
  try {
    buffer = await readFile(filePath);
  } catch (error) {
    if (isNotFound(error)) {
      throw new Error(`Asset object is missing for ${assetId}.`);
    }
    throw error;
  }

  const digest = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
  if (buffer.byteLength !== expectedSize || digest !== expectedDigest) {
    throw new Error(`Asset object failed its integrity check for ${assetId}.`);
  }
  return buffer;
}

/** @returns {{fileName: string, displayName: string, type: "jar" | "zip"}} */
function validateFile(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("Asset fileName must be a non-empty string.");
  }
  const fileName = value.normalize("NFKC").trim();
  if (fileName.length > 255 || fileName === "." || fileName === ".." || /[\\/\0-\x1f\x7f]/.test(fileName)) {
    throw new Error("Asset fileName must be a safe base name without path separators or control characters.");
  }
  const lowerName = fileName.toLowerCase();
  const extension = lowerName.endsWith(".jar") ? ".jar" : lowerName.endsWith(".zip") ? ".zip" : "";
  if (extension !== ".jar" && extension !== ".zip") {
    throw new Error("Asset fileName must end in .jar or .zip.");
  }
  const stem = fileName.slice(0, -extension.length);
  if (!stem) {
    throw new Error("Asset fileName must include a name before its extension.");
  }
  const displayName = stem
    .replace(/[<>"'`&]/g, " ")
    .replace(/[^\p{L}\p{N} ._()\[\]-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Asset";
  return { fileName, displayName, type: extension === ".jar" ? "jar" : "zip" };
}

function validateBuffer(value) {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError("Asset buffer must be a Buffer or Uint8Array.");
  }
  if (value.byteLength === 0) {
    throw new Error("Asset buffer must not be empty.");
  }
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function validateSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Asset summary must be supplied after indexing.");
  }
  const namespaces = Array.isArray(value.namespaces) ? value.namespaces : null;
  if (!namespaces || namespaces.some((namespace) => typeof namespace !== "string" || !NAMESPACE_PATTERN.test(namespace))) {
    throw new Error("Asset summary namespaces must contain valid resource namespaces.");
  }
  return {
    textures: nonNegativeInteger(value.textures, "textures"),
    models: nonNegativeInteger(value.models, "models"),
    blockstates: nonNegativeInteger(value.blockstates, "blockstates"),
    namespaces: [...new Set(namespaces)].sort((left, right) => left.localeCompare(right))
  };
}

function validateManifest(value, sourceName) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.manifestVersion !== MANIFEST_VERSION) {
    throw new Error(`Unsupported or malformed asset manifest: ${sourceName}`);
  }
  const id = validateId(value.id);
  const sequence = positiveInteger(value.sequence, "sequence");
  const file = validateFile(value.fileName);
  if (value.displayName !== file.displayName || value.type !== file.type) {
    throw new Error(`Asset manifest has unsafe derived metadata: ${sourceName}`);
  }
  if (!DIGEST_PATTERN.test(value.digest)) {
    throw new Error(`Asset manifest has an invalid digest: ${sourceName}`);
  }
  const size = positiveInteger(value.size, "size");
  const importedAt = normalizeTimestamp(value.importedAt);
  const summary = validateSummary(value.summary);
  return {
    manifestVersion: MANIFEST_VERSION,
    id,
    sequence,
    fileName: file.fileName,
    displayName: file.displayName,
    type: file.type,
    size,
    digest: value.digest,
    importedAt,
    summary
  };
}

function validateId(value) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new Error("Asset id must contain only safe letters, numbers, dots, underscores, or hyphens.");
  }
  return value;
}

function normalizeTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Asset importedAt timestamp is invalid.");
  }
  return date.toISOString();
}

function nonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Asset summary ${name} must be a non-negative integer.`);
  }
  return value;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Asset manifest ${name} must be a positive integer.`);
  }
  return value;
}

function safeChildPath(parent, child) {
  if (typeof child !== "string" || !child || path.basename(child) !== child) {
    throw new Error("Unsafe asset library path segment.");
  }
  const resolvedParent = path.resolve(parent);
  const resolved = path.resolve(resolvedParent, child);
  if (path.dirname(resolved) !== resolvedParent) {
    throw new Error("Asset library path escaped its storage directory.");
  }
  return resolved;
}

function compareManifests(left, right) {
  return left.sequence - right.sequence || left.id.localeCompare(right.id);
}

function cloneManifest(manifest) {
  return {
    ...manifest,
    summary: {
      ...manifest.summary,
      namespaces: [...manifest.summary.namespaces]
    }
  };
}

function isAlreadyExists(error) {
  return error && typeof error === "object" && "code" in error && error.code === "EEXIST";
}

function isNotFound(error) {
  return error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

/**
 * @typedef {{textures: number, models: number, blockstates: number, namespaces: string[]}} AssetSummary
 * @typedef {{
 *   manifestVersion: 1,
 *   id: string,
 *   sequence: number,
 *   fileName: string,
 *   displayName: string,
 *   type: "jar" | "zip",
 *   size: number,
 *   digest: string,
 *   importedAt: string,
 *   summary: AssetSummary
 * }} AssetManifest
 */
