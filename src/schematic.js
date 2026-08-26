import { parseNbt } from "./nbt.js";

const BLOCK_LIMIT = 1000000;

export function parseSchematic(buffer) {
  const root = parseNbt(buffer);
  const data = root.value;
  const sponge = parseSpongeSchematic(data);
  const size = sponge?.size || vectorFrom(findValue(data, ["size", "Size", "bounds", "Bounds"])) || inferSize(data);
  const palette = normalizePalette(findValue(data, ["palette", "Palette", "palettes", "Palettes", "block_palette", "BlockPalette"]));
  const resolvedPalette = sponge?.palette || palette;
  const blocks = sponge?.blocks || normalizeBlocks(findValue(data, ["blocks", "Blocks", "blockList", "BlockList"]), resolvedPalette);
  const entities = findValue(data, ["entities", "Entities"]) || [];
  const blockEntities = findValue(data, ["BlockEntities", "blockEntities"]) || [];
  const blockCounts = countBlocks(blocks);
  const missingPaletteRefs = blocks.filter((block) => block.unresolved).length;

  return {
    rootName: root.name,
    dataVersion: data.DataVersion || data.dataVersion || null,
    size: size || boundsFromBlocks(blocks),
    palette: resolvedPalette,
    blocks: blocks.slice(0, BLOCK_LIMIT),
    truncated: blocks.length > BLOCK_LIMIT,
    totalBlocks: blocks.length,
    visibleBlocks: blocks.filter((block) => block.name !== "minecraft:air" && block.name !== "air").length,
    blockCounts,
    entities: Array.isArray(entities) ? entities.length : 0,
    blockEntities: Array.isArray(blockEntities) ? blockEntities.length : 0,
    warnings: buildWarnings({ blocks, palette: resolvedPalette, missingPaletteRefs })
  };
}

function parseSpongeSchematic(data) {
  if (!Array.isArray(data.BlockData) || !data.Palette || data.Width === undefined || data.Height === undefined || data.Length === undefined) {
    return null;
  }

  const size = { x: Number(data.Width), y: Number(data.Height), z: Number(data.Length) };
  const palette = normalizePalette(data.Palette);
  const blockEntityPositions = new Set((data.BlockEntities || []).map((entry) => {
    const pos = vectorFrom(entry.Pos || entry.pos);
    return pos ? `${pos.x},${pos.y},${pos.z}` : null;
  }).filter(Boolean));
  const stateIndexes = decodeVarints(data.BlockData, size.x * size.y * size.z);
  const blocks = [];

  for (let index = 0; index < stateIndexes.length; index += 1) {
    const state = stateIndexes[index];
    const paletteEntry = palette[state];
    if (!paletteEntry || paletteEntry.name === "minecraft:air" || paletteEntry.name === "air") {
      continue;
    }

    const x = index % size.x;
    const z = Math.floor(index / size.x) % size.z;
    const y = Math.floor(index / (size.x * size.z));
    const key = `${x},${y},${z}`;
    blocks.push({
      index,
      pos: { x, y, z },
      state,
      name: paletteEntry.name,
      properties: paletteEntry.properties,
      label: paletteEntry.label,
      hasNbt: blockEntityPositions.has(key),
      unresolved: false
    });
  }

  return { size, palette, blocks };
}

function decodeVarints(bytes, expectedLength) {
  const values = [];
  let value = 0;
  let shift = 0;

  for (const raw of bytes) {
    const byte = raw & 0xff;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      values.push(value);
      if (values.length >= expectedLength) {
        break;
      }
      value = 0;
      shift = 0;
    } else {
      shift += 7;
    }
  }

  return values;
}

function normalizePalette(rawPalette) {
  const raw = Array.isArray(rawPalette) && Array.isArray(rawPalette[0]) ? rawPalette[0] : rawPalette;

  if (Array.isArray(raw)) {
    return raw.map((entry, index) => normalizePaletteEntry(entry, index));
  }

  if (raw && typeof raw === "object") {
    return Object.entries(raw)
      .sort(([, a], [, b]) => Number(a) - Number(b))
      .map(([key, value], index) => normalizePaletteEntry(paletteEntryFromKey(key, value), index));
  }

  return [];
}

function normalizePaletteEntry(entry, index) {
  if (typeof entry === "string") {
    return { index, name: entry, properties: {}, label: entry };
  }

  const name = entry?.Name || entry?.name || entry?.id || entry?.Block || "unknown:block";
  const properties = entry?.Properties || entry?.properties || {};
  return {
    index,
    name,
    properties,
    label: formatBlockState(name, properties)
  };
}

function paletteEntryFromKey(key, value) {
  if (typeof value === "object" && value) {
    return value;
  }

  const [name, propertyText] = key.split("[");
  const properties = {};
  if (propertyText) {
    propertyText.replace(/\]$/, "").split(",").forEach((part) => {
      const [property, propertyValue] = part.split("=");
      if (property && propertyValue) {
        properties[property] = propertyValue;
      }
    });
  }
  return { Name: name, Properties: properties };
}

function normalizeBlocks(rawBlocks, palette) {
  if (!Array.isArray(rawBlocks)) {
    return [];
  }

  return rawBlocks.map((entry, index) => {
    const pos = vectorFrom(entry?.pos || entry?.Pos || entry?.position || entry?.Position) || { x: 0, y: 0, z: 0 };
    const stateIndex = Number(entry?.state ?? entry?.State ?? entry?.palette ?? entry?.Palette ?? -1);
    const directName = entry?.Name || entry?.name || entry?.id;
    const paletteEntry = palette[stateIndex];
    const resolved = directName
      ? normalizePaletteEntry({ Name: directName, Properties: entry?.Properties || entry?.properties || {} }, stateIndex)
      : paletteEntry;

    return {
      index,
      pos,
      state: stateIndex,
      name: resolved?.name || "unknown:block",
      properties: resolved?.properties || {},
      label: resolved?.label || "unknown:block",
      hasNbt: Boolean(entry?.nbt || entry?.NBT || entry?.BlockEntityTag),
      unresolved: !resolved
    };
  });
}

function countBlocks(blocks) {
  const counts = new Map();
  for (const block of blocks) {
    if (block.name === "minecraft:air" || block.name === "air") {
      continue;
    }
    counts.set(block.label, (counts.get(block.label) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function findValue(object, names) {
  if (!object || typeof object !== "object") {
    return undefined;
  }

  for (const name of names) {
    if (Object.hasOwn(object, name)) {
      return object[name];
    }
  }

  return undefined;
}

function vectorFrom(value) {
  if (Array.isArray(value) && value.length >= 3) {
    return { x: Number(value[0]), y: Number(value[1]), z: Number(value[2]) };
  }

  if (value && typeof value === "object") {
    const x = value.x ?? value.X ?? value[0];
    const y = value.y ?? value.Y ?? value[1];
    const z = value.z ?? value.Z ?? value[2];
    if ([x, y, z].every((part) => part !== undefined)) {
      return { x: Number(x), y: Number(y), z: Number(z) };
    }
  }

  return null;
}

function boundsFromBlocks(blocks) {
  if (!blocks.length) {
    return { x: 0, y: 0, z: 0 };
  }

  return blocks.reduce(
    (max, block) => ({
      x: Math.max(max.x, block.pos.x + 1),
      y: Math.max(max.y, block.pos.y + 1),
      z: Math.max(max.z, block.pos.z + 1)
    }),
    { x: 0, y: 0, z: 0 }
  );
}

function inferSize(data) {
  const blocks = findValue(data, ["blocks", "Blocks", "blockList", "BlockList"]);
  if (!Array.isArray(blocks)) {
    return null;
  }

  return boundsFromBlocks(
    blocks.map((block) => ({
      pos: vectorFrom(block?.pos || block?.Pos || block?.position || block?.Position) || { x: 0, y: 0, z: 0 }
    }))
  );
}

function formatBlockState(name, properties) {
  const entries = Object.entries(properties || {});
  if (!entries.length) {
    return name;
  }
  return `${name}[${entries.map(([key, value]) => `${key}=${value}`).join(",")}]`;
}

function buildWarnings({ blocks, palette, missingPaletteRefs }) {
  const warnings = [];
  if (!blocks.length) {
    warnings.push("No block list was found. This file may use a schematic variant that needs another adapter.");
  }
  if (!palette.length) {
    warnings.push("No palette was found. Direct block names will still render if the file includes them.");
  }
  if (missingPaletteRefs) {
    warnings.push(`${missingPaletteRefs} block entries referenced palette states that could not be resolved.`);
  }
  if (blocks.length > BLOCK_LIMIT) {
    warnings.push(`Preview payload was capped at ${BLOCK_LIMIT.toLocaleString()} blocks to keep the browser responsive.`);
  }
  return warnings;
}
