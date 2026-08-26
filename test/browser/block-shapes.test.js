import assert from "node:assert/strict";
import test from "node:test";

import {
  blockShape,
  directionInfo,
  isKnownNonFullBlock,
  isOpaqueFullCube,
  shouldUseExplicitGeometry
} from "../../public/js/block-shapes.js";

test("slabs preserve bottom, top, and double geometry", () => {
  assert.deepEqual(blockShape("minecraft:stone_slab", { type: "bottom" }), {
    type: "box",
    size: [0.995, 0.495, 0.995],
    offset: [0, -0.25, 0],
    fullUnit: false
  });
  assert.equal(blockShape("minecraft:stone_slab", { type: "top" }).offset[1], 0.25);
  assert.equal(blockShape("minecraft:stone_slab", { type: "double" }).fullUnit, true);
});

test("stairs preserve facing and half orientation", () => {
  assert.deepEqual(blockShape("minecraft:oak_stairs", { facing: "east", half: "top" }), {
    type: "boxes",
    boxes: [
      { size: [0.995, 0.495, 0.995], offset: [0, 0.25, 0] },
      { size: [0.5, 0.495, 0.995], offset: [0.25, -0.25, 0] }
    ],
    offset: [0, 0, 0],
    fullUnit: false
  });
});

test("panes use declared connections and retain the unconnected fallback", () => {
  const connected = blockShape("minecraft:glass_pane", { north: "true", east: "true" });
  assert.equal(connected.type, "boxes");
  assert.deepEqual(connected.boxes, [
    { size: [0.18, 0.995, 0.18], offset: [0, 0, 0] },
    { size: [0.18, 0.995, 0.5], offset: [0, 0, -0.25] },
    { size: [0.5, 0.995, 0.18], offset: [0.25, 0, 0] }
  ]);

  const unconnected = blockShape("minecraft:iron_bars");
  assert.deepEqual(unconnected.boxes[1], { size: [0.18, 0.995, 0.995], offset: [0, 0, 0] });
});

test("pipes connect in every direction by default and only to declared sides otherwise", () => {
  assert.equal(blockShape("create:fluid_pipe").boxes.length, 7);
  assert.deepEqual(blockShape("create:fluid_pipe", { up: "true" }).boxes, [
    { size: [0.36, 0.36, 0.36], offset: [0, 0, 0] },
    { size: [0.26, 0.5, 0.26], offset: [0, 0.25, 0] }
  ]);
});

test("Create columns preserve inferred and explicit axes", () => {
  assert.deepEqual(blockShape("create:shaft").size, [0.995, 0.28, 0.28]);

  const girder = blockShape("create:metal_girder", { axis: "z" });
  assert.equal(girder.type, "boxes");
  assert.deepEqual(girder.boxes, [
    { size: [0.34, 0.34, 0.995], offset: [0, 0, 0] },
    { size: [0.46, 0.46, 0.08], offset: [0, 0, -0.46] },
    { size: [0.46, 0.46, 0.08], offset: [0, 0, 0.46] }
  ]);
});

test("plants use renderer-neutral cross descriptors", () => {
  assert.deepEqual(blockShape("minecraft:dandelion"), {
    type: "cross",
    width: 0.95,
    height: 0.78,
    offset: [0, -0.08, 0],
    fullUnit: false
  });
  assert.equal(blockShape("minecraft:tall_grass").height, 0.95);
  assert.equal(blockShape("minecraft:grass_block").type, "box");
});

test("trapdoors preserve open facing and closed half", () => {
  assert.deepEqual(blockShape("minecraft:oak_trapdoor", { open: "true", facing: "west" }), {
    type: "box",
    size: [0.16, 0.995, 0.995],
    offset: [-0.42, 0, 0],
    fullUnit: false
  });
  assert.deepEqual(blockShape("minecraft:oak_trapdoor", { open: "false", half: "top" }).offset, [0, 0.42, 0]);
});

test("doors preserve their facing plane", () => {
  assert.deepEqual(blockShape("minecraft:oak_door", { facing: "south" }), {
    type: "box",
    size: [0.995, 0.995, 0.16],
    offset: [0, 0, 0.42],
    fullUnit: false
  });
});

test("full cubes retain the existing 0.995 unit box", () => {
  assert.deepEqual(blockShape("minecraft:stone"), {
    type: "box",
    size: [0.995, 0.995, 0.995],
    offset: [0, 0, 0],
    fullUnit: true
  });
});

test("classification helpers preserve explicit and opaque decisions", () => {
  assert.equal(isKnownNonFullBlock("minecraft:torch"), true);
  assert.equal(shouldUseExplicitGeometry("minecraft:oak_stairs"), true);
  assert.equal(shouldUseExplicitGeometry("minecraft:stone"), false);
  assert.equal(isOpaqueFullCube("minecraft:stone[axis=y]"), true);
  assert.equal(isOpaqueFullCube("minecraft:oak_leaves[persistent=true]"), false);
  assert.equal(isOpaqueFullCube("minecraft:glass"), false);
});

test("direction information defaults to north and is isolated from callers", () => {
  assert.deepEqual(directionInfo("up"), {
    axis: "y",
    sign: 1,
    vector: [0, 1, 0],
    opposite: "down"
  });
  const unknown = directionInfo("sideways");
  unknown.vector[2] = 99;
  assert.deepEqual(directionInfo("sideways").vector, [0, 0, -1]);
});
