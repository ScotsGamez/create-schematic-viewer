import { inflateRawSync } from "node:zlib";

const library = {
  packs: [],
  textures: new Map(),
  models: new Map(),
  blockstates: new Map()
};

export function loadAssetPack(buffer, name = "asset-pack.jar") {
  const entries = readZipEntries(buffer);
  const pack = {
    name,
    textures: new Map(),
    models: new Map(),
    blockstates: new Map()
  };

  for (const entry of entries) {
    const match = entry.name.match(/^assets\/([^/]+)\/(textures|models|blockstates)\/(.+)$/);
    if (!match) {
      continue;
    }

    const [, namespace, type, assetPath] = match;
    if (type === "textures" && assetPath.endsWith(".png")) {
      const key = `${namespace}:${assetPath.replace(/\.png$/, "")}`;
      pack.textures.set(key, entry.data);
    }

    if (type === "models" && assetPath.endsWith(".json")) {
      const key = `${namespace}:${assetPath.replace(/\.json$/, "")}`;
      pack.models.set(key, parseJson(entry.data, entry.name));
    }

    if (type === "blockstates" && assetPath.endsWith(".json")) {
      const key = `${namespace}:${assetPath.replace(/\.json$/, "")}`;
      pack.blockstates.set(key, parseJson(entry.data, entry.name));
    }
  }

  library.packs.push(pack);
  rebuildMergedAssets();

  return assetSummary();
}

export function assetSummary() {
  const namespaces = new Set();
  for (const key of [...library.textures.keys(), ...library.models.keys(), ...library.blockstates.keys()]) {
    namespaces.add(key.split(":")[0]);
  }

  return {
    name: library.packs.at(-1)?.name || null,
    packs: library.packs.map((pack) => ({
      name: pack.name,
      textures: pack.textures.size,
      models: pack.models.size,
      blockstates: pack.blockstates.size
    })),
    namespaces: [...namespaces].sort(),
    textures: library.textures.size,
    models: library.models.size,
    blockstates: library.blockstates.size
  };
}

export function getTexture(textureId) {
  return library.textures.get(textureId) || null;
}

export function resolveBlockTextures(blockId) {
  const id = normalizeBlockId(blockId);
  const [namespace, path] = splitId(id);
  const blockstate = library.blockstates.get(`${namespace}:${path}`);
  const modelIds = modelIdsFromBlockstate(blockstate, namespace);
  const modelId = modelIds[0] || `${namespace}:block/${path}`;
  const model = resolveModel(modelId);

  if (!model) {
    const direct = `${namespace}:block/${path}`;
    return textureResponse(id, {
      all: direct,
      north: direct,
      south: direct,
      east: direct,
      west: direct,
      up: direct,
      down: direct
    });
  }

  const faces = faceTextureRefs(model);
  const fallback = resolveTextureRef("#all", model.textures) ||
    resolveTextureRef("#side", model.textures) ||
    resolveTextureRef("#texture", model.textures) ||
    model.textures?.particle ||
    `${namespace}:block/${path}`;

  return textureResponse(id, {
    all: fallback,
    north: resolveTextureRef(faces.north, model.textures) || fallback,
    south: resolveTextureRef(faces.south, model.textures) || fallback,
    east: resolveTextureRef(faces.east, model.textures) || fallback,
    west: resolveTextureRef(faces.west, model.textures) || fallback,
    up: resolveTextureRef(faces.up, model.textures) || resolveTextureRef("#top", model.textures) || fallback,
    down: resolveTextureRef(faces.down, model.textures) || resolveTextureRef("#bottom", model.textures) || fallback
  });
}

export function resolveBlockModel(blockId) {
  const id = normalizeBlockId(blockId);
  const [namespace, path] = splitId(id);
  const blockstate = library.blockstates.get(`${namespace}:${path}`);
  const modelIds = modelIdsFromBlockstate(blockstate, namespace);
  const modelId = modelIds[0] || `${namespace}:block/${path}`;
  const model = resolveModel(modelId);

  return {
    blockId: id,
    found: Boolean(model),
    model
  };
}

function textureResponse(blockId, textures) {
  const resolved = {};
  for (const [face, textureId] of Object.entries(textures)) {
    const normalized = normalizeTextureId(textureId, blockId.split(":")[0]);
    if (library.textures.has(normalized)) {
      resolved[face] = {
        id: normalized,
        url: `/api/assets/textures/${encodeURIComponent(normalized)}`
      };
    }
  }

  return {
    blockId,
    found: Object.keys(resolved).length > 0,
    textures: resolved
  };
}

function resolveModel(modelId, seen = new Set()) {
  const normalized = normalizeModelId(modelId);
  if (seen.has(normalized)) {
    return null;
  }
  seen.add(normalized);

  const model = library.models.get(normalized);
  if (!model) {
    return null;
  }

  const parent = model.parent ? resolveModel(model.parent.includes(":") ? model.parent : `${normalized.split(":")[0]}:${model.parent}`, seen) : null;
  return {
    ...parent,
    ...model,
    textures: {
      ...(parent?.textures || {}),
      ...(model.textures || {})
    },
    elements: model.elements || parent?.elements || []
  };
}

function rebuildMergedAssets() {
  library.textures = new Map();
  library.models = new Map();
  library.blockstates = new Map();

  for (const pack of library.packs) {
    for (const [key, value] of pack.textures) library.textures.set(key, value);
    for (const [key, value] of pack.models) library.models.set(key, value);
    for (const [key, value] of pack.blockstates) library.blockstates.set(key, value);
  }
}

function modelIdsFromBlockstate(blockstate, namespace) {
  if (!blockstate) {
    return [];
  }

  if (blockstate.variants) {
    return Object.values(blockstate.variants)
      .flatMap((variant) => Array.isArray(variant) ? variant : [variant])
      .map((variant) => variant?.model)
      .filter(Boolean)
      .map((model) => model.includes(":") ? model : `${namespace}:${model}`);
  }

  if (Array.isArray(blockstate.multipart)) {
    return blockstate.multipart
      .flatMap((part) => Array.isArray(part.apply) ? part.apply : [part.apply])
      .map((variant) => variant?.model)
      .filter(Boolean)
      .map((model) => model.includes(":") ? model : `${namespace}:${model}`);
  }

  return [];
}

function faceTextureRefs(model) {
  const faces = {};
  for (const element of model.elements || []) {
    for (const [face, data] of Object.entries(element.faces || {})) {
      faces[face] ||= data.texture;
    }
  }
  return faces;
}

function resolveTextureRef(ref, textures = {}, depth = 0) {
  if (!ref || depth > 16) {
    return null;
  }
  if (!String(ref).startsWith("#")) {
    return ref;
  }

  const next = textures[String(ref).slice(1)];
  if (!next) {
    return null;
  }
  return resolveTextureRef(next, textures, depth + 1);
}

function normalizeBlockId(id) {
  return id.includes(":") ? id : `minecraft:${id}`;
}

function normalizeModelId(id) {
  const [namespace, path] = splitId(id);
  return `${namespace}:${path}`;
}

function normalizeTextureId(id, fallbackNamespace) {
  if (!id) {
    return "";
  }
  return id.includes(":") ? id : `${fallbackNamespace}:${id}`;
}

function splitId(id) {
  const [namespace, ...path] = id.split(":");
  return path.length ? [namespace, path.join(":")] : ["minecraft", namespace];
}

function parseJson(buffer, name) {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    return { parseError: `Unable to parse ${name}` };
  }
}

function readZipEntries(buffer) {
  const entries = [];
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) {
    throw new Error("Could not find ZIP central directory.");
  }

  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;

  while (offset < end) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      break;
    }

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength).replaceAll("\\", "/");

    if (!name.endsWith("/")) {
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
      const data = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
      if (data) {
        entries.push({ name, data });
      }
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer) {
  const min = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  return -1;
}
