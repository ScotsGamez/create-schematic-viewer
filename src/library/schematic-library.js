import { createHash, randomBytes, randomUUID } from "node:crypto";
import { open, mkdir, readFile, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";

const SCHEMA_VERSION = 1;
const ENTRY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_TEXT = Object.freeze({
  title: 160,
  description: 4000,
  tag: 64,
  sourceFilename: 255,
  sourceUrl: 2048,
  author: 200,
  license: 200
});

/**
 * Create a filesystem-backed schematic library.
 *
 * The interface accepts canonical and original bytes at `importVersion()` and
 * keeps content-addressed objects immutable. A validator must be supplied
 * either here or for each import; it may return normalized schematic metadata
 * such as `size`, `totalBlocks`, `visibleBlocks`, and `dataVersion`.
 *
 * @param {{
 *   rootDir: string,
 *   clock?: () => Date | string | number,
 *   idFactory?: () => string,
 *   validateCanonical?: (bytes: Buffer) => unknown | Promise<unknown>
 * }} options
 */
export function createSchematicLibrary({
  rootDir,
  clock = () => new Date(),
  idFactory = randomUUID,
  validateCanonical
}) {
  if (!rootDir || typeof rootDir !== "string") {
    throw new TypeError("rootDir must be a non-empty string.");
  }
  if (typeof clock !== "function" || typeof idFactory !== "function") {
    throw new TypeError("clock and idFactory must be functions.");
  }
  if (validateCanonical !== undefined && typeof validateCanonical !== "function") {
    throw new TypeError("validateCanonical must be a function when provided.");
  }

  const root = path.resolve(rootDir);
  const manifestsDir = resolveContainedPath(root, "manifests");
  const objectsDir = resolveContainedPath(root, "objects");
  const canonicalDir = resolveContainedPath(objectsDir, "canonical", "sha256");
  const originalDir = resolveContainedPath(objectsDir, "original", "sha256");
  const previewDir = resolveContainedPath(objectsDir, "preview", "sha256");
  let initialization;
  let mutationQueue = Promise.resolve();

  async function initialize() {
    initialization ||= Promise.all([
      mkdir(manifestsDir, { recursive: true }),
      mkdir(canonicalDir, { recursive: true }),
      mkdir(originalDir, { recursive: true }),
      mkdir(previewDir, { recursive: true })
    ]).then(() => undefined);
    return initialization;
  }

  /** @param {{includeTrashed?: boolean}} [options] */
  async function list({ includeTrashed = false } = {}) {
    await initialize();
    const names = (await readdir(manifestsDir))
      .filter((name) => name.endsWith(".json"))
      .sort((a, b) => a.localeCompare(b));
    const entries = await Promise.all(names.map((name) => readManifestFile(resolveContainedPath(manifestsDir, name))));
    return entries
      .filter((entry) => includeTrashed || !entry.trashedAt)
      .sort((a, b) => compareText(a.metadata.title, b.metadata.title) || compareText(a.id, b.id));
  }

  /** @param {string} entryId */
  async function get(entryId) {
    await initialize();
    return readManifest(entryId, { missing: "null" });
  }

  /**
   * Import an immutable version. Supplying an existing `entryId` appends a new
   * version; omitting it creates an entry with an ID from `idFactory`.
   *
   * @param {{
   *   entryId?: string,
   *   canonical: Buffer | Uint8Array,
   *   original?: Buffer | Uint8Array,
   *   metadata?: {title?: string, description?: string, tags?: string[], sourceFilename?: string, sourceUrl?: string, author?: string, license?: string},
   *   provenance?: {sourceFilename?: string, sourceUrl?: string, author?: string, license?: string},
   *   validateCanonical?: (bytes: Buffer) => unknown | Promise<unknown>
   * }} input
   */
  async function importVersion(input) {
    return serialize(async () => {
      await initialize();
      if (!input || typeof input !== "object") {
        throw new TypeError("importVersion input is required.");
      }

      const explicitId = input.entryId !== undefined;
      const entryId = explicitId ? validateEntryId(input.entryId) : await unusedEntryId();
      const existing = await readManifest(entryId, { missing: "null" });
      const canonicalBytes = asBuffer(input.canonical, "canonical");
      const originalBytes = input.original === undefined
        ? canonicalBytes
        : asBuffer(input.original, "original");
      const validator = input.validateCanonical || validateCanonical;
      if (typeof validator !== "function") {
        throw new TypeError("A validateCanonical function is required for every import.");
      }

      const validatedSchematic = await validator(Buffer.from(canonicalBytes));
      const normalizedSchematic = normalizeSchematicMetadata(validatedSchematic);
      const metadata = normalizeMetadata(input.metadata, input.provenance);
      const previewBytes = Buffer.from(renderPreviewSvg(
        metadata,
        normalizedSchematic,
        normalizePreviewBlocks(validatedSchematic)
      ), "utf8");
      const canonicalObject = await writeObject(canonicalDir, canonicalBytes, ".nbt");
      const originalObject = await writeObject(originalDir, originalBytes, ".source");
      const previewObject = await writeObject(previewDir, previewBytes, ".svg");

      const timestamp = now();
      const version = Object.freeze({
        version: (existing?.versions.length || 0) + 1,
        importedAt: timestamp,
        canonical: canonicalObject,
        original: originalObject,
        preview: previewObject,
        metadata,
        provenance: metadata.provenance,
        schematic: normalizedSchematic
      });
      const manifest = existing
        ? {
            ...existing,
            updatedAt: timestamp,
            metadata,
            versions: [...existing.versions, version]
          }
        : {
            schemaVersion: SCHEMA_VERSION,
            id: entryId,
            createdAt: timestamp,
            updatedAt: timestamp,
            trashedAt: null,
            metadata,
            versions: [version]
          };

      await writeManifest(manifest);
      return clone(manifest);
    });
  }

  /** @param {string} entryId */
  async function trash(entryId) {
    return updateTrashState(entryId, true);
  }

  /** @param {string} entryId */
  async function restore(entryId) {
    return updateTrashState(entryId, false);
  }

  /** @param {string} entryId @param {number} [version] */
  async function readCanonical(entryId, version) {
    return readVersionObject(entryId, version, "canonical", canonicalDir, ".nbt");
  }

  /** @param {string} entryId @param {number} [version] */
  async function readOriginal(entryId, version) {
    return readVersionObject(entryId, version, "original", originalDir, ".source");
  }

  /** @param {string} entryId @param {number} [version] */
  async function readPreview(entryId, version) {
    return readVersionObject(entryId, version, "preview", previewDir, ".svg");
  }

  async function updateTrashState(entryId, trashed) {
    return serialize(async () => {
      await initialize();
      const manifest = await requireManifest(entryId);
      const timestamp = now();
      const updated = {
        ...manifest,
        updatedAt: timestamp,
        trashedAt: trashed ? (manifest.trashedAt || timestamp) : null
      };
      await writeManifest(updated);
      return clone(updated);
    });
  }

  async function readVersionObject(entryId, versionNumber, key, directory, extension) {
    await initialize();
    const manifest = await requireManifest(entryId);
    const record = resolveVersion(manifest, versionNumber);
    const object = record[key];
    const objectPath = objectPathFor(directory, object.sha256, extension);
    const bytes = await readFile(objectPath);
    if (sha256(bytes) !== object.sha256) {
      throw new Error(`Stored ${key} object failed its SHA-256 integrity check.`);
    }
    return bytes;
  }

  function serialize(operation) {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  function now() {
    const value = new Date(clock());
    if (Number.isNaN(value.getTime())) {
      throw new TypeError("clock returned an invalid date.");
    }
    return value.toISOString();
  }

  async function unusedEntryId() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = validateEntryId(idFactory());
      if (!await readManifest(candidate, { missing: "null" })) {
        return candidate;
      }
    }
    throw new Error("idFactory did not produce an unused entry ID.");
  }

  async function requireManifest(entryId) {
    const manifest = await readManifest(entryId, { missing: "throw" });
    return manifest;
  }

  async function readManifest(entryId, { missing }) {
    const id = validateEntryId(entryId);
    try {
      return await readManifestFile(manifestPath(id));
    } catch (error) {
      if (error?.code === "ENOENT") {
        if (missing === "null") {
          return null;
        }
        throw new Error(`Schematic library entry '${id}' was not found.`, { cause: error });
      }
      throw error;
    }
  }

  async function readManifestFile(file) {
    const manifest = JSON.parse(await readFile(file, "utf8"));
    validateStoredManifest(manifest);
    return clone(manifest);
  }

  async function writeManifest(manifest) {
    const target = manifestPath(manifest.id);
    const temporary = `${target}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
    const json = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeExclusiveFile(temporary, Buffer.from(json), 0o600);
    try {
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async function writeObject(directory, bytes, extension) {
    const digest = sha256(bytes);
    const target = objectPathFor(directory, digest, extension);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeExclusiveFile(target, bytes, 0o600);
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      const existing = await readFile(target);
      if (sha256(existing) !== digest) {
        throw new Error("A content-addressed object failed its SHA-256 integrity check.");
      }
    }
    return Object.freeze({ algorithm: "sha256", sha256: digest, size: bytes.length });
  }

  function manifestPath(entryId) {
    return resolveContainedPath(manifestsDir, `${validateEntryId(entryId)}.json`);
  }

  return Object.freeze({
    initialize,
    list,
    get,
    importVersion,
    trash,
    restore,
    readCanonical,
    readOriginal,
    readPreview
  });
}

function objectPathFor(directory, digest, extension) {
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error("Stored object digest is invalid.");
  }
  return resolveContainedPath(directory, digest.slice(0, 2), `${digest.slice(2)}${extension}`);
}

function resolveContainedPath(parent, ...segments) {
  const candidate = path.resolve(parent, ...segments);
  const relative = path.relative(path.resolve(parent), candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Resolved path escapes the schematic library root.");
  }
  return candidate;
}

function validateEntryId(value) {
  if (typeof value !== "string" || !ENTRY_ID_PATTERN.test(value)) {
    throw new TypeError("entryId must contain only letters, numbers, underscores, or hyphens (maximum 128 characters).");
  }
  return value;
}

function asBuffer(value, name) {
  if (!(Buffer.isBuffer(value) || value instanceof Uint8Array)) {
    throw new TypeError(`${name} must be a Buffer or Uint8Array.`);
  }
  if (value.byteLength === 0) {
    throw new TypeError(`${name} must not be empty.`);
  }
  return Buffer.from(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeExclusiveFile(file, bytes, mode) {
  const handle = await open(file, "wx", mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function normalizeMetadata(metadata = {}, provenance = {}) {
  if (!isPlainObject(metadata) || !isPlainObject(provenance)) {
    throw new TypeError("metadata and provenance must be objects.");
  }
  const sourceFilename = cleanFilename(provenance.sourceFilename ?? metadata.sourceFilename);
  const title = cleanText(metadata.title, "title", MAX_TEXT.title)
    || titleFromFilename(sourceFilename)
    || "Untitled schematic";
  const sourceUrl = cleanText(provenance.sourceUrl ?? metadata.sourceUrl, "sourceUrl", MAX_TEXT.sourceUrl);
  if (sourceUrl) {
    let parsed;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      throw new TypeError("sourceUrl must be a valid HTTP or HTTPS URL.");
    }
    if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
      throw new TypeError("sourceUrl must be a valid HTTP or HTTPS URL.");
    }
  }

  return Object.freeze({
    title,
    description: cleanText(metadata.description, "description", MAX_TEXT.description) || "",
    tags: normalizeTags(metadata.tags),
    provenance: Object.freeze({
      sourceFilename: sourceFilename || null,
      sourceUrl: sourceUrl || null,
      author: cleanText(provenance.author ?? metadata.author, "author", MAX_TEXT.author) || null,
      license: cleanText(provenance.license ?? metadata.license, "license", MAX_TEXT.license) || null
    })
  });
}

function normalizeTags(value) {
  if (value === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(value)) {
    throw new TypeError("metadata.tags must be an array of strings.");
  }
  const tags = value.map((tag) => cleanText(tag, "tag", MAX_TEXT.tag).toLowerCase())
    .filter(Boolean);
  return Object.freeze([...new Set(tags)].sort(compareText));
}

function cleanFilename(value) {
  const text = cleanText(value, "sourceFilename", MAX_TEXT.sourceFilename);
  if (!text) {
    return "";
  }
  return path.posix.basename(text.replaceAll("\\", "/"));
}

function titleFromFilename(filename) {
  return filename.replace(/(?:\.nbt|\.schem|\.schematic|\.zip)$/i, "").trim();
}

function cleanText(value, name, maximum) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string.`);
  }
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length > maximum) {
    throw new TypeError(`${name} must be ${maximum} characters or fewer.`);
  }
  return text;
}

function normalizeSchematicMetadata(value) {
  const source = isPlainObject(value) ? value : {};
  const size = isPlainObject(source.size) ? source.size : {};
  const warnings = Array.isArray(source.warnings)
    ? source.warnings.slice(0, 100).map((warning) => String(warning).trim().slice(0, 500)).filter(Boolean)
    : [];
  return Object.freeze({
    size: Object.freeze({
      x: nonnegativeInteger(size.x),
      y: nonnegativeInteger(size.y),
      z: nonnegativeInteger(size.z)
    }),
    totalBlocks: nonnegativeInteger(source.totalBlocks),
    visibleBlocks: nonnegativeInteger(source.visibleBlocks),
    dataVersion: source.dataVersion === undefined || source.dataVersion === null
      ? null
      : nonnegativeInteger(source.dataVersion),
    warnings: Object.freeze(warnings)
  });
}

function nonnegativeInteger(value) {
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function normalizePreviewBlocks(value) {
  const source = isPlainObject(value) && Array.isArray(value.blocks) ? value.blocks : [];
  const visible = source.filter((block) => {
    const pos = block?.pos;
    const name = String(block?.name || block?.label || "").split("[")[0];
    return name !== "air" && name !== "minecraft:air"
      && pos
      && [pos.x, pos.y, pos.z].every((coordinate) => Number.isFinite(Number(coordinate)));
  });
  const step = Math.max(1, Math.ceil(visible.length / 180));
  return visible.filter((_, index) => index % step === 0).slice(0, 180).map((block) => ({
    x: Number(block.pos.x),
    y: Number(block.pos.y),
    z: Number(block.pos.z),
    label: String(block.label || block.name || "minecraft:block")
  }));
}

function renderPreviewScene(blocks, schematic) {
  if (!blocks.length) {
    return `  <path d="M392 220L482 168L572 220L482 272Z" fill="#166534" stroke="#86efac" stroke-width="2"/>\n`
      + `  <path d="M392 220V246L482 298V272Z" fill="#14532d"/>\n`
      + `  <path d="M572 220V246L482 298V272Z" fill="#052e16"/>\n`;
  }

  const maxX = Math.max(1, schematic.size.x - 1);
  const maxY = Math.max(1, schematic.size.y - 1);
  const maxZ = Math.max(1, schematic.size.z - 1);
  return [...blocks]
    .sort((left, right) => (left.x + left.z + left.y) - (right.x + right.z + right.y))
    .map((block) => {
      const x = block.x / maxX;
      const y = block.y / maxY;
      const z = block.z / maxZ;
      const centerX = 482 + (x - z) * 100;
      const centerY = 252 + (x + z) * 38 - y * 112;
      const hue = [...block.label].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) % 360, 120);
      return `  <polygon points="${centerX.toFixed(1)},${(centerY - 5).toFixed(1)} ${(centerX + 6).toFixed(1)},${centerY.toFixed(1)} ${centerX.toFixed(1)},${(centerY + 5).toFixed(1)} ${(centerX - 6).toFixed(1)},${centerY.toFixed(1)}" fill="hsl(${hue} 45% 48%)" opacity=".9"/>`;
    })
    .join("\n") + "\n";
}

function renderPreviewSvg(metadata, schematic, blocks) {
  const title = escapeXml(metadata.title);
  const description = escapeXml(metadata.description || "No description provided");
  const tags = escapeXml(metadata.tags.length ? metadata.tags.join("  •  ") : "Uncategorized");
  const dimensions = `${schematic.size.x} × ${schematic.size.y} × ${schematic.size.z}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img" aria-label="${title} schematic preview">\n`
    + `  <rect width="640" height="360" fill="#111827"/>\n`
    + `  <path d="M0 270L170 170L340 270L170 360Z" fill="#166534" opacity=".75"/>\n`
    + `  <path d="M340 270L510 170L680 270L510 360Z" fill="#14532d" opacity=".8"/>\n`
    + renderPreviewScene(blocks, schematic)
    + `  <text x="40" y="70" fill="#f9fafb" font-family="system-ui,sans-serif" font-size="32" font-weight="700">${title}</text>\n`
    + `  <text x="40" y="112" fill="#d1d5db" font-family="system-ui,sans-serif" font-size="17">${description}</text>\n`
    + `  <text x="40" y="178" fill="#86efac" font-family="ui-monospace,monospace" font-size="20">${dimensions}</text>\n`
    + `  <text x="40" y="215" fill="#d1fae5" font-family="system-ui,sans-serif" font-size="17">${schematic.visibleBlocks.toLocaleString("en-US")} visible blocks</text>\n`
    + `  <text x="40" y="322" fill="#9ca3af" font-family="system-ui,sans-serif" font-size="15">${tags}</text>\n`
    + `</svg>\n`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function resolveVersion(manifest, versionNumber) {
  const record = versionNumber === undefined
    ? manifest.versions.at(-1)
    : manifest.versions.find((candidate) => candidate.version === versionNumber);
  if (!record) {
    throw new Error(`Version '${versionNumber}' was not found for schematic '${manifest.id}'.`);
  }
  return record;
}

function validateStoredManifest(manifest) {
  if (!isPlainObject(manifest) || manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new Error("Schematic library manifest has an unsupported schema version.");
  }
  validateEntryId(manifest.id);
  if (!Array.isArray(manifest.versions) || manifest.versions.length === 0) {
    throw new Error("Schematic library manifest has no versions.");
  }
  for (const [index, version] of manifest.versions.entries()) {
    if (version.version !== index + 1) {
      throw new Error("Schematic library manifest version history is invalid.");
    }
    for (const key of ["canonical", "original", "preview"]) {
      if (!version[key] || version[key].algorithm !== "sha256" || !/^[a-f0-9]{64}$/.test(version[key].sha256)) {
        throw new Error(`Schematic library manifest contains an invalid ${key} object reference.`);
      }
    }
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
