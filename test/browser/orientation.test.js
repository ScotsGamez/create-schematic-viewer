import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ORIENTATION,
  mapFacing,
  mappedProperties,
  orientedPosition,
  orientationProfile
} from "../../public/js/orientation.js";

test("default orientation retains the viewer's established values", () => {
  assert.deepEqual(DEFAULT_ORIENTATION, {
    facingPreset: "invert-all",
    schematicYaw: 0,
    flipX: false,
    flipZ: false
  });
  assert.equal(Object.isFrozen(DEFAULT_ORIENTATION), true);
});

test("positions support each cardinal yaw", () => {
  const position = { x: 0, y: 7, z: 1 };
  const size = { x: 4, y: 10, z: 6 };

  assert.deepEqual(orientedPosition(position, size, { schematicYaw: 0 }), { x: 0, y: 7, z: 1 });
  assert.deepEqual(orientedPosition(position, size, { schematicYaw: 90 }), { x: 4, y: 7, z: 0 });
  assert.deepEqual(orientedPosition(position, size, { schematicYaw: 180 }), { x: 3, y: 7, z: 4 });
  assert.deepEqual(orientedPosition(position, size, { schematicYaw: 270 }), { x: 1, y: 7, z: 3 });
});

test("position flips happen before yaw and do not mutate inputs", () => {
  const position = { x: 1, y: 2, z: 2 };
  const size = { x: 4, z: 6 };
  const orientation = { schematicYaw: 90, flipX: true, flipZ: true };

  assert.deepEqual(orientedPosition(position, size, orientation), { x: 2, y: 2, z: 2 });
  assert.deepEqual(position, { x: 1, y: 2, z: 2 });
  assert.deepEqual(orientation, { schematicYaw: 90, flipX: true, flipZ: true });
});

test("facing presets map all horizontal directions and preserve unsupported values", () => {
  const expected = {
    minecraft: ["north", "east", "south", "west"],
    "swap-ns": ["south", "east", "north", "west"],
    "swap-ew": ["north", "west", "south", "east"],
    "rotate-cw": ["east", "south", "west", "north"],
    "rotate-ccw": ["west", "north", "east", "south"],
    "invert-all": ["south", "west", "north", "east"]
  };

  for (const [preset, directions] of Object.entries(expected)) {
    assert.deepEqual(
      ["north", "east", "south", "west"].map((facing) => mapFacing(facing, preset)),
      directions
    );
    assert.equal(mapFacing("up", preset), "up");
    assert.equal(mapFacing("down", preset), "down");
  }
  assert.equal(mapFacing("north", "unknown"), "north");
  assert.equal(mapFacing("axis-x", "rotate-cw"), "axis-x");
});

test("directional properties remap into a new record", () => {
  const properties = {
    facing: "north",
    north: "n",
    east: "e",
    south: "s",
    west: "w",
    waterlogged: "false"
  };

  assert.deepEqual(mappedProperties(properties, "rotate-cw"), {
    facing: "east",
    north: "w",
    east: "n",
    south: "e",
    west: "s",
    waterlogged: "false"
  });
  assert.deepEqual(properties, {
    facing: "north",
    north: "n",
    east: "e",
    south: "s",
    west: "w",
    waterlogged: "false"
  });
});

test("orientation profiles are portable snapshots with derived mappings", () => {
  const orientation = {
    facingPreset: "rotate-ccw",
    schematicYaw: 270,
    flipX: true,
    flipZ: false
  };
  const profile = orientationProfile(orientation);

  assert.deepEqual(profile, {
    type: "create-schematic-viewer-orientation",
    version: 1,
    note: "Use this as the default orientation profile for future schematics if this view matches Minecraft.",
    orientation,
    facingMap: {
      north: "west",
      south: "east",
      east: "north",
      west: "south",
      up: "up",
      down: "down"
    },
    schematicTransform: {
      yawDegrees: 270,
      flipX: true,
      flipZ: false
    }
  });
  assert.notEqual(profile.orientation, orientation);
});

test("orientation profiles fill omitted values from the established default", () => {
  const profile = orientationProfile({ schematicYaw: 180 });
  assert.deepEqual(profile.orientation, {
    ...DEFAULT_ORIENTATION,
    schematicYaw: 180
  });
  assert.equal(profile.facingMap.north, "south");
});
