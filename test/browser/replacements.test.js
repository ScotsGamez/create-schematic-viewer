import assert from "node:assert/strict";
import test from "node:test";

import {
  WOOD_TYPES,
  replaceWoodInLabel,
  woodLabel,
  woodMatches,
  woodToken
} from "../../public/js/replacements.js";

test("supported wood types retain their UI order", () => {
  assert.deepEqual(WOOD_TYPES, [
    "oak",
    "spruce",
    "birch",
    "jungle",
    "acacia",
    "dark_oak",
    "mangrove",
    "cherry",
    "bamboo",
    "crimson",
    "warped",
    "pale_oak"
  ]);
  assert.equal(Object.isFrozen(WOOD_TYPES), true);
});

test("wood names normalize for matching and format for display", () => {
  assert.equal(woodToken("  Dark Oak "), "dark_oak");
  assert.equal(woodToken("PALE   OAK"), "pale_oak");
  assert.equal(woodLabel("dark_oak"), "Dark Oak");
  assert.equal(woodLabel(" pale  oak "), "Pale Oak");
});

test("wood replacement retains block properties and replaces every ID token", () => {
  assert.equal(
    replaceWoodInLabel("minecraft:spruce_stairs[facing=north,half=top]", "spruce", "oak"),
    "minecraft:oak_stairs[facing=north,half=top]"
  );
  assert.equal(
    replaceWoodInLabel("example:spruce_spruce_block[axis=y]", "spruce", "dark oak"),
    "example:dark_oak_dark_oak_block[axis=y]"
  );
  assert.equal(
    replaceWoodInLabel("minecraft:stone", "spruce", "oak"),
    "minecraft:stone"
  );
});

test("wood matching filters palette entries by block ID only", () => {
  const spruceLog = { label: "minecraft:stripped_spruce_log[axis=y]", count: 12 };
  const spruceStairs = { label: "minecraft:spruce_stairs[facing=north]", count: 4 };
  const propertyOnly = { label: "example:selector[variant=spruce]", count: 1 };
  const schematic = { blockCounts: [spruceLog, spruceStairs, propertyOnly] };

  assert.deepEqual(woodMatches(schematic, " Spruce "), [spruceLog, spruceStairs]);
  assert.deepEqual(woodMatches(schematic, "oak"), []);
  assert.deepEqual(woodMatches(null, "spruce"), []);
});
