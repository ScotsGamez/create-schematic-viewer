import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { extname, join } from "node:path";

import { createAssetLibrary } from "../library/asset-library.js";
import { createSchematicLibrary } from "../library/schematic-library.js";
import { canonicalizeNbt } from "../nbt.js";

const SCHEMATIC_COLLECTION_PATH = "/api/v1/library/schematics";
const ASSET_COLLECTION_PATH = "/api/v1/library/assets";

export class LibraryHttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Own the persistent library lifecycle and its versioned HTTP surface.
 *
 * @param {{
 *   dataDir: string,
 *   canWrite: (request: import("node:http").IncomingMessage) => boolean,
 *   maxUploadBytes: number,
 *   parseSchematic: (bytes: Buffer) => unknown,
 *   loadAssetPack: (bytes: Buffer, fileName: string) => any
 * }} options
 */
export function createLibraryApi({
  dataDir,
  canWrite,
  maxUploadBytes,
  parseSchematic,
  loadAssetPack
}) {
  const schematicLibrary = createSchematicLibrary({
    rootDir: join(dataDir, "schematics"),
    validateCanonical: parseSchematic
  });
  const assetLibrary = createAssetLibrary({ rootDir: join(dataDir, "assets") });
  const initialization = Promise.all([
    schematicLibrary.initialize(),
    assetLibrary.initialize()
  ]).then(async () => {
    const result = await assetLibrary.rehydrate((buffer, asset) => {
      loadAssetPack(buffer, asset.fileName);
    });
    if (result.failed.length) {
      throw new Error(`Unable to rehydrate ${result.failed.length} persisted asset pack(s).`);
    }
  });

  async function checkReadiness() {
    await initialization;
    await access(dataDir, fsConstants.R_OK | fsConstants.W_OK);
    await Promise.all([
      schematicLibrary.list({ includeTrashed: true }),
      assetLibrary.list()
    ]);
  }

  async function handle(request, response, url) {
    if (!url.pathname.startsWith("/api/v1/library/")) {
      return false;
    }
    await initialization;

    if (request.method === "GET" && url.pathname === SCHEMATIC_COLLECTION_PATH) {
      const includeTrashed = url.searchParams.get("includeTrashed") === "true";
      const query = String(url.searchParams.get("query") || "").trim().toLocaleLowerCase();
      const entries = await schematicLibrary.list({ includeTrashed });
      const items = entries.filter((entry) => matchesQuery(entry, query)).map(latestSchematicView);
      response.setHeader("cache-control", "no-store");
      sendJson(response, 200, {
        items,
        total: items.length,
        capabilities: { canWrite: canWrite(request) }
      });
      return true;
    }

    if (request.method === "POST" && url.pathname === SCHEMATIC_COLLECTION_PATH) {
      requireWriteAccess(request);
      const entry = await importSchematic(request);
      sendJson(response, 201, latestSchematicView(entry));
      return true;
    }

    if (request.method === "GET" && url.pathname === ASSET_COLLECTION_PATH) {
      sendJson(response, 200, { items: await assetLibrary.list() });
      return true;
    }

    if (request.method === "POST" && url.pathname === ASSET_COLLECTION_PATH) {
      requireWriteAccess(request);
      await importAsset(request, response);
      return true;
    }

    const item = matchSchematicItemPath(url.pathname);
    if (!item) {
      throw new LibraryHttpError(404, "Library endpoint was not found.");
    }
    const entry = await schematicLibrary.get(item.id);
    if (!entry) throw new LibraryHttpError(404, "Schematic was not found.");

    if (request.method === "GET" && item.action === "detail") {
      sendJson(response, 200, schematicDetailView(entry));
      return true;
    }

    if (request.method === "GET" && item.action === "content") {
      if (entry.trashedAt) throw new LibraryHttpError(410, "Schematic is in trash.");
      const body = await schematicLibrary.readCanonical(entry.id, requestedVersion(url));
      const view = latestSchematicView(entry);
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${safeBaseName(view.fileName.replace(/\.nbt$/i, ""))}.nbt"`,
        "content-length": body.length,
        "x-content-type-options": "nosniff"
      });
      response.end(body);
      return true;
    }

    if (request.method === "GET" && item.action === "preview") {
      const body = await schematicLibrary.readPreview(entry.id, requestedVersion(url));
      response.writeHead(200, {
        "content-type": "image/svg+xml; charset=utf-8",
        "content-length": body.length,
        "cache-control": "private, max-age=300",
        "content-security-policy": "default-src 'none'; sandbox",
        "x-content-type-options": "nosniff"
      });
      response.end(body);
      return true;
    }

    if (request.method === "POST" && item.action === "versions") {
      requireWriteAccess(request);
      if (entry.trashedAt) throw new LibraryHttpError(409, "Restore the schematic before adding a version.");
      const updated = await importSchematic(request, entry.id);
      sendJson(response, 201, latestSchematicView(updated));
      return true;
    }

    if (request.method === "POST" && item.action === "restore") {
      requireWriteAccess(request);
      sendJson(response, 200, latestSchematicView(await schematicLibrary.restore(entry.id)));
      return true;
    }

    if (request.method === "DELETE" && item.action === "detail") {
      requireWriteAccess(request);
      sendJson(response, 200, latestSchematicView(await schematicLibrary.trash(entry.id)));
      return true;
    }

    throw new LibraryHttpError(405, "Method is not allowed for this library endpoint.");
  }

  async function importAsset(request, response) {
    await initialization;
    requireWriteAccess(request);
    const body = await readRequestBody(request, maxUploadBytes);
    const fileName = String(request.headers["x-file-name"] || "asset-pack.jar");
    const summary = loadAssetPack(body, fileName);
    const indexed = summary.packs.at(-1);
    await assetLibrary.importAsset({
      fileName,
      buffer: body,
      summary: {
        textures: indexed?.textures || 0,
        models: indexed?.models || 0,
        blockstates: indexed?.blockstates || 0,
        namespaces: indexed?.namespaces || summary.namespaces
      }
    });
    sendJson(response, 200, summary);
  }

  async function importSchematic(request, entryId) {
    const fileName = requireCanonicalFileName(request);
    const original = await readRequestBody(request, maxUploadBytes);
    const supplied = requestMetadata(request);
    parseSchematic(original);
    return schematicLibrary.importVersion({
      entryId,
      canonical: canonicalizeNbt(original),
      original,
      metadata: {
        title: String(request.headers["x-title"] || supplied.title || fileName),
        description: supplied.description,
        tags: supplied.tags
      },
      provenance: {
        sourceFilename: fileName,
        sourceUrl: supplied.sourceUrl,
        author: supplied.author,
        license: supplied.license
      }
    });
  }

  function requireWriteAccess(request) {
    if (!canWrite(request)) {
      throw new LibraryHttpError(403, "Shared-library changes are not authorized for this request.");
    }
  }

  return Object.freeze({ initialization, checkReadiness, handle, importAsset });
}

function matchSchematicItemPath(pathname) {
  const prefix = `${SCHEMATIC_COLLECTION_PATH}/`;
  if (!pathname.startsWith(prefix)) return null;
  const segments = pathname.slice(prefix.length).split("/");
  if (segments.length < 1 || segments.length > 2 || !segments[0]) return null;
  const id = decodeURIComponent(segments[0]);
  const action = segments[1] || "detail";
  const actions = { content: "content", "preview.svg": "preview", restore: "restore", versions: "versions", detail: "detail" };
  return actions[action] ? { id, action: actions[action] } : null;
}

function requestMetadata(request) {
  const encoded = request.headers["x-library-metadata"];
  if (!encoded) return {};
  const value = JSON.parse(decodeURIComponent(String(encoded)));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Library metadata must be a JSON object.");
  }
  return value;
}

function requireCanonicalFileName(request) {
  const fileName = String(request.headers["x-file-name"] || "schematic.nbt");
  if (extname(fileName).toLowerCase() !== ".nbt") {
    throw new LibraryHttpError(415, "The shared library accepts validated .nbt files. Convert .schem or .litematic files first.");
  }
  return fileName;
}

function requestedVersion(url) {
  const value = url.searchParams.get("version");
  if (value === null || value === "") return undefined;
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new LibraryHttpError(400, "version must be a positive integer.");
  }
  return version;
}

function latestSchematicView(entry) {
  const latest = entry.versions.at(-1);
  const provenance = latest?.provenance || entry.metadata.provenance || {};
  return {
    id: entry.id,
    title: entry.metadata.title,
    description: entry.metadata.description,
    tags: entry.metadata.tags,
    fileName: provenance.sourceFilename || `${safeBaseName(entry.metadata.title)}.nbt`,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    trashed: Boolean(entry.trashedAt),
    deletedAt: entry.trashedAt,
    version: latest?.version || 1,
    dimensions: latest?.schematic.size,
    totalBlocks: latest?.schematic.totalBlocks,
    visibleBlocks: latest?.schematic.visibleBlocks,
    dataVersion: latest?.schematic.dataVersion,
    warnings: latest?.schematic.warnings || []
  };
}

function schematicDetailView(entry) {
  return {
    ...latestSchematicView(entry),
    metadata: entry.metadata,
    versions: entry.versions.map((version) => ({
      version: version.version,
      importedAt: version.importedAt,
      metadata: version.metadata,
      provenance: version.provenance,
      schematic: version.schematic,
      canonical: version.canonical,
      original: version.original
    }))
  };
}

function matchesQuery(entry, query) {
  if (!query) return true;
  const view = latestSchematicView(entry);
  return [view.title, view.description, view.fileName, ...(view.tags || [])]
    .some((value) => String(value || "").toLocaleLowerCase().includes(query));
}

function safeBaseName(name) {
  return String(name)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90) || "schematic";
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

function readRequestBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        request.destroy(new Error(`Upload is larger than ${Math.round(limit / 1024 / 1024)} MB.`));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}
