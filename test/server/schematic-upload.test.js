import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync, gzipSync } from "node:zlib";

import {
  combineSchematicParts,
  parseUploadedSchematic,
  validateSchematicZip
} from "../../src/server/schematic-upload.js";

test("combineSchematicParts stacks parts and normalizes their palettes", () => {
  const result = combineSchematicParts([
    {
      name: "factory_part_1_of_2.nbt",
      schematic: normalizedSchematic({
        dataVersion: 3465,
        size: { x: 2, y: 2, z: 1 },
        entities: 1,
        blocks: [
          block("minecraft:stone", { x: 0, y: 0, z: 0 }),
          block("minecraft:oak_log[axis=x]", { x: 1, y: 1, z: 0 }, "minecraft:oak_log", { axis: "x" })
        ],
        warnings: ["first warning"]
      })
    },
    {
      name: "factory_part_2_of_2.nbt",
      schematic: normalizedSchematic({
        dataVersion: 3466,
        size: { x: 3, y: 1, z: 4 },
        blockEntities: 2,
        blocks: [
          block("minecraft:stone", { x: 2, y: 0, z: 3 }),
          block("minecraft:dirt", { x: 1, y: 0, z: 1 })
        ]
      })
    }
  ]);

  assert.equal(result.rootName, "combined_zip");
  assert.equal(result.dataVersion, 3465);
  assert.deepEqual(result.size, { x: 3, y: 3, z: 4 });
  assert.equal(result.totalBlocks, 4);
  assert.equal(result.visibleBlocks, 4);
  assert.equal(result.entities, 1);
  assert.equal(result.blockEntities, 2);
  assert.deepEqual(result.blocks.map(({ index, state, pos }) => ({ index, state, pos })), [
    { index: 0, state: 0, pos: { x: 0, y: 0, z: 0 } },
    { index: 1, state: 1, pos: { x: 1, y: 1, z: 0 } },
    { index: 2, state: 0, pos: { x: 2, y: 2, z: 3 } },
    { index: 3, state: 2, pos: { x: 1, y: 2, z: 1 } }
  ]);
  assert.deepEqual(result.palette, [
    { index: 0, name: "minecraft:stone", properties: {}, label: "minecraft:stone" },
    { index: 1, name: "minecraft:oak_log", properties: { axis: "x" }, label: "minecraft:oak_log[axis=x]" },
    { index: 2, name: "minecraft:dirt", properties: {}, label: "minecraft:dirt" }
  ]);
  assert.deepEqual(result.blockCounts, [
    { label: "minecraft:stone", count: 2 },
    { label: "minecraft:dirt", count: 1 },
    { label: "minecraft:oak_log[axis=x]", count: 1 }
  ]);
  assert.deepEqual(result.warnings, [
    "Loaded 2 zipped schematic part(s) in part-number order.",
    "factory_part_1_of_2.nbt: first warning"
  ]);
});

test("parseUploadedSchematic parses a single NBT upload", () => {
  const result = parseUploadedSchematic(nbtDocument({ dataVersion: 42, size: [1, 2, 3] }));

  assert.equal(result.rootName, "fixture");
  assert.equal(result.dataVersion, 42);
  assert.deepEqual(result.size, { x: 1, y: 2, z: 3 });
});

test("parseUploadedSchematic orders zipped parts by their numbered suffix", () => {
  const archive = zip([
    { name: "factory_part_2_of_2.nbt", data: nbtDocument({ dataVersion: 200, size: [1, 3, 1] }), method: 8 },
    { name: "factory_part_1_of_2.nbt", data: nbtDocument({ dataVersion: 100, size: [1, 2, 1] }) }
  ]);

  const result = parseUploadedSchematic(archive);

  assert.equal(result.dataVersion, 100);
  assert.deepEqual(result.size, { x: 1, y: 5, z: 1 });
  assert.equal(result.warnings[0], "Loaded 2 zipped schematic part(s) in part-number order.");
});

test("parseUploadedSchematic rejects a zip without NBT parts", () => {
  assert.throws(
    () => parseUploadedSchematic(zip([{ name: "readme.txt", data: Buffer.from("hello") }])),
    /Zip does not contain any \.nbt schematic parts\./
  );
});

test("validateSchematicZip accepts gzipped NBT and rejects plain NBT", () => {
  const document = nbtDocument({ dataVersion: 42, size: [1, 1, 1] });

  assert.doesNotThrow(() => validateSchematicZip(zip([{ name: "part.nbt", data: gzipSync(document) }])));
  assert.throws(
    () => validateSchematicZip(zip([{ name: "part.nbt", data: document }])),
    /Zip entry part\.nbt is not gzipped NBT\./
  );
});

function block(label, pos, name = label, properties = {}) {
  return { label, name, properties, pos, index: 99, state: 99, hasNbt: false, unresolved: false };
}

function normalizedSchematic({
  dataVersion,
  size,
  blocks,
  entities = 0,
  blockEntities = 0,
  warnings = []
}) {
  return {
    rootName: "fixture",
    dataVersion,
    size,
    palette: [],
    blocks,
    truncated: false,
    totalBlocks: blocks.length,
    visibleBlocks: blocks.length,
    blockCounts: [],
    entities,
    blockEntities,
    warnings
  };
}

function nbtDocument({ dataVersion, size }) {
  const rootName = Buffer.from("fixture");
  const dataVersionName = Buffer.from("DataVersion");
  const sizeName = Buffer.from("size");
  const header = Buffer.alloc(3 + rootName.length);
  header.writeUInt8(10, 0);
  header.writeUInt16BE(rootName.length, 1);
  rootName.copy(header, 3);

  const versionTag = Buffer.alloc(1 + 2 + dataVersionName.length + 4);
  versionTag.writeUInt8(3, 0);
  versionTag.writeUInt16BE(dataVersionName.length, 1);
  dataVersionName.copy(versionTag, 3);
  versionTag.writeInt32BE(dataVersion, 3 + dataVersionName.length);

  const sizeTag = Buffer.alloc(1 + 2 + sizeName.length + 1 + 4 + 12);
  sizeTag.writeUInt8(9, 0);
  sizeTag.writeUInt16BE(sizeName.length, 1);
  sizeName.copy(sizeTag, 3);
  let offset = 3 + sizeName.length;
  sizeTag.writeUInt8(3, offset);
  sizeTag.writeInt32BE(3, offset + 1);
  sizeTag.writeInt32BE(size[0], offset + 5);
  sizeTag.writeInt32BE(size[1], offset + 9);
  sizeTag.writeInt32BE(size[2], offset + 13);

  return Buffer.concat([header, versionTag, sizeTag, Buffer.from([0])]);
}

function zip(entries) {
  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data);
    const method = entry.method || 0;
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localRecords.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralRecords.push(central, name);
    localOffset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, centralDirectory, eocd]);
}
