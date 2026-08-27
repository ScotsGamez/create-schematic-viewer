import { inflateRawSync } from "node:zlib";

import { parseSchematic } from "../schematic.js";

const PREVIEW_BLOCK_LIMIT = 1000000;

/**
 * Parse either a single schematic or a ZIP containing ordered `.nbt` parts.
 *
 * @param {Buffer} body
 * @returns {ReturnType<typeof parseSchematic>}
 */
export function parseUploadedSchematic(body) {
  if (!isZip(body)) {
    return parseSchematic(body);
  }

  const entries = extractZipEntries(body)
    .filter((entry) => entry.name.toLowerCase().endsWith(".nbt"))
    .sort((a, b) => partOrder(a.name) - partOrder(b.name) || a.name.localeCompare(b.name));

  if (!entries.length) {
    throw new Error("Zip does not contain any .nbt schematic parts.");
  }

  return combineSchematicParts(entries.map((entry) => ({
    name: entry.name,
    schematic: parseSchematic(entry.data)
  })));
}

/**
 * Combine normalized schematic parts by stacking them along the Y axis.
 * Parts must already be in the desired order.
 *
 * @param {Array<{name: string, schematic: ReturnType<typeof parseSchematic>}>} parts
 */
export function combineSchematicParts(parts) {
  const allBlocks = [];
  const paletteLookup = new Map();
  const palette = [];
  const blockCounts = new Map();
  const warnings = [];
  let yOffset = 0;
  let totalBlocks = 0;
  let visibleBlocks = 0;
  let maxX = 0;
  let maxZ = 0;
  const dataVersion = parts[0]?.schematic.dataVersion || null;

  for (const part of parts) {
    const schematic = part.schematic;
    maxX = Math.max(maxX, Number(schematic.size?.x || 0));
    maxZ = Math.max(maxZ, Number(schematic.size?.z || 0));
    totalBlocks += schematic.totalBlocks;
    visibleBlocks += schematic.visibleBlocks;
    warnings.push(...(schematic.warnings || []).map((warning) => `${part.name}: ${warning}`));

    for (const block of schematic.blocks) {
      const label = block.label;
      if (!paletteLookup.has(label)) {
        paletteLookup.set(label, palette.length);
        palette.push({ index: palette.length, name: block.name, properties: block.properties || {}, label });
      }
      blockCounts.set(label, (blockCounts.get(label) || 0) + 1);
      if (allBlocks.length < PREVIEW_BLOCK_LIMIT) {
        allBlocks.push({
          ...block,
          index: allBlocks.length,
          state: paletteLookup.get(label),
          pos: { x: block.pos.x, y: block.pos.y + yOffset, z: block.pos.z }
        });
      }
    }
    yOffset += Number(schematic.size?.y || 0);
  }

  return {
    rootName: "combined_zip",
    dataVersion,
    size: { x: maxX, y: yOffset, z: maxZ },
    palette,
    blocks: allBlocks,
    truncated: totalBlocks > PREVIEW_BLOCK_LIMIT,
    totalBlocks,
    visibleBlocks,
    blockCounts: [...blockCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    entities: parts.reduce((sum, part) => sum + Number(part.schematic.entities || 0), 0),
    blockEntities: parts.reduce((sum, part) => sum + Number(part.schematic.blockEntities || 0), 0),
    warnings: [
      `Loaded ${parts.length} zipped schematic part(s) in part-number order.`,
      ...warnings
    ]
  };
}

/**
 * Verify that converter output contains at least one gzipped, parseable NBT file.
 *
 * @param {Buffer} buffer
 */
export function validateSchematicZip(buffer) {
  const entries = extractZipEntries(buffer).filter((entry) => entry.name.toLowerCase().endsWith(".nbt"));
  if (!entries.length) {
    throw new Error("Converter produced a zip without any .nbt files.");
  }
  for (const entry of entries) {
    if (entry.data[0] !== 0x1f || entry.data[1] !== 0x8b) {
      throw new Error(`Zip entry ${entry.name} is not gzipped NBT.`);
    }
    parseSchematic(entry.data);
  }
}

function isZip(buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

function extractZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;

  while (offset < end) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Zip central directory is malformed.");
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const encoding = (flags & 0x0800) !== 0 ? "utf8" : "utf8";
    const name = buffer.toString(encoding, offset + 46, offset + 46 + fileNameLength).replace(/\\/g, "/");

    if (!name.endsWith("/")) {
      entries.push({ name, data: extractZipEntry(buffer, localHeaderOffset, compressedSize, method) });
    }
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function extractZipEntry(buffer, localHeaderOffset, compressedSize, method) {
  if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
    throw new Error("Zip local file header is malformed.");
  }
  const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataOffset = localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
  if (method === 0) {
    return Buffer.from(compressed);
  }
  if (method === 8) {
    return inflateRawSync(compressed);
  }
  throw new Error(`Zip entry uses unsupported compression method ${method}.`);
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("Zip end-of-central-directory record was not found.");
}

function partOrder(name) {
  const match = String(name).match(/_part_(\d+)_of_(\d+)\.nbt$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
