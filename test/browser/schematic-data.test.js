import assert from "node:assert/strict";
import test from "node:test";

import {
  arrayBufferToBase64,
  baseFileName,
  blockIdFromLabel,
  csvCell,
  isGzipNbt,
  itemListCsv,
  itemListRows,
  itemListText,
  modifiedFileName,
  positionKey,
  propertiesFromLabel
} from "../../public/js/schematic-data.js";

test("palette labels split into block IDs and property records", () => {
  assert.equal(blockIdFromLabel("  minecraft:oak_stairs[facing=north,half=top]"), "minecraft:oak_stairs");
  assert.equal(blockIdFromLabel("minecraft:stone"), "minecraft:stone");
  assert.deepEqual(propertiesFromLabel("minecraft:oak_stairs[facing=north,half=top]"), {
    facing: "north",
    half: "top"
  });
  assert.deepEqual(propertiesFromLabel("minecraft:stone"), {});
  assert.deepEqual(propertiesFromLabel("minecraft:test[]"), {});
});

test("position keys retain the renderer's comma-separated representation", () => {
  assert.equal(positionKey(4, -2, 9), "4,-2,9");
  assert.equal(positionKey("1", 2, 3), "1,2,3");
});

test("download filenames preserve existing sanitization and extension rules", () => {
  assert.equal(baseFileName("Castle Build.nbt"), "Castle_Build");
  assert.equal(baseFileName("../../strange name.schem"), ".._.._strange_name");
  assert.equal(baseFileName("!!!.nbt"), "schematic");
  assert.equal(modifiedFileName("castle.nbt"), "castle-modified.nbt");
  assert.equal(modifiedFileName("castle"), "castle-modified.nbt");
  assert.equal(modifiedFileName("archive.schematic.nbt"), "archive.schematic-modified.nbt");
  assert.equal(modifiedFileName(".nbt"), "schematic-modified.nbt");
});

test("gzip detection requires the signature and at least one additional byte", () => {
  assert.equal(isGzipNbt(Uint8Array.of(0x1f, 0x8b, 0x08)), true);
  assert.equal(isGzipNbt(Uint8Array.of(0x1f, 0x8b)), false);
  assert.equal(isGzipNbt(Uint8Array.of(0x1f, 0x00, 0x08)), false);
});

test("base64 encoding works for empty, padded, binary, and sliced view inputs", () => {
  assert.equal(arrayBufferToBase64(new ArrayBuffer(0)), "");
  assert.equal(arrayBufferToBase64(Uint8Array.of(0x66)), "Zg==");
  assert.equal(arrayBufferToBase64(Uint8Array.of(0x66, 0x6f)), "Zm8=");
  assert.equal(arrayBufferToBase64(Uint8Array.of(0x66, 0x6f, 0x6f)), "Zm9v");
  assert.equal(arrayBufferToBase64(Uint8Array.of(0x00, 0xff, 0x10)), "AP8Q");

  const backing = Uint8Array.of(9, 0x66, 0x6f, 0x6f, 9);
  assert.equal(arrayBufferToBase64(backing.subarray(1, 4)), "Zm9v");
});

test("item-list rows apply replacements, aggregate equal states, and sort deterministically", () => {
  const schematic = {
    blockCounts: [
      { label: "minecraft:stone", count: 65 },
      { label: "minecraft:spruce_planks", count: 20 },
      { label: "minecraft:oak_planks", count: 44 },
      { label: "minecraft:dirt[snowy=false]", count: 65 },
      { label: "minecraft:andesite", count: 65 }
    ]
  };
  const replacements = new Map([
    ["minecraft:spruce_planks", "minecraft:oak_planks"]
  ]);

  assert.deepEqual(itemListRows(schematic, replacements), [
    { id: "minecraft:andesite", state: "minecraft:andesite", count: 65, stacks: 1, remainder: 1 },
    { id: "minecraft:dirt", state: "minecraft:dirt[snowy=false]", count: 65, stacks: 1, remainder: 1 },
    { id: "minecraft:stone", state: "minecraft:stone", count: 65, stacks: 1, remainder: 1 },
    { id: "minecraft:oak_planks", state: "minecraft:oak_planks", count: 64, stacks: 1, remainder: 0 }
  ]);
  assert.deepEqual(itemListRows(null, replacements), []);
});

test("CSV cells and complete exports quote only values that need it", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("with,comma"), '"with,comma"');
  assert.equal(csvCell('with "quote"'), '"with ""quote"""');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(csvCell(42), "42");

  const rows = [{
    id: "example:block",
    state: "example:block[name=one,two]",
    count: 130,
    stacks: 2,
    remainder: 2
  }];
  assert.equal(
    itemListCsv(rows),
    'block_id,block_state,count,stacks_64,remainder\r\nexample:block,"example:block[name=one,two]",130,2,2'
  );
});

test("plain-text item lists include the requested filename and aligned stack counts", () => {
  const rows = [{ state: "minecraft:stone", count: 130, stacks: 2, remainder: 2 }];
  assert.equal(
    itemListText(rows, "castle.nbt"),
    "Item list for castle.nbt\n========================\n    130     2x64 +  2  minecraft:stone"
  );
  assert.equal(itemListText([], ""), "Item list for schematic\n=======================");
});
