const CARDINALS = ["north", "south", "east", "west"];

const DIRECTIONS = {
  north: { axis: "z", sign: -1, vector: [0, 0, -1], opposite: "south" },
  south: { axis: "z", sign: 1, vector: [0, 0, 1], opposite: "north" },
  west: { axis: "x", sign: -1, vector: [-1, 0, 0], opposite: "east" },
  east: { axis: "x", sign: 1, vector: [1, 0, 0], opposite: "west" },
  up: { axis: "y", sign: 1, vector: [0, 1, 0], opposite: "down" },
  down: { axis: "y", sign: -1, vector: [0, -1, 0], opposite: "up" }
};

/**
 * Describe a block's approximate render shape without depending on a renderer.
 *
 * @param {string} id Minecraft block identifier.
 * @param {Record<string, string>} [properties] Block-state properties.
 * @returns {{type: "box", size: number[], offset: number[], fullUnit: boolean} |
 *   {type: "boxes", boxes: Array<{size: number[], offset: number[]}>, offset: number[], fullUnit: boolean} |
 *   {type: "cross", width: number, height: number, offset: number[], fullUnit: false}}
 */
export function blockShape(id, properties = {}) {
  if (id.includes("scaffolding")) {
    return boxesDescriptor(scaffoldBoxes());
  }

  if (isCrossPlant(id)) {
    return {
      type: "cross",
      width: 0.95,
      height: id.includes("tall_grass") || id.includes("large_fern") ? 0.95 : 0.78,
      offset: [0, -0.08, 0],
      fullUnit: false
    };
  }

  if (isCreatePipe(id)) {
    return boxesDescriptor(pipeBoxes(properties));
  }

  if (id.includes("valve") || id.includes("faucet") || id.includes("spout") || id.includes("nozzle")) {
    return boxesDescriptor(faucetBoxes(properties));
  }

  if (isCreateColumn(id)) {
    return boxesDescriptor(columnBoxes(id, properties));
  }

  if (id.includes("torch") && !id.includes("redstone_wall_torch")) {
    return boxesDescriptor([
      { size: [0.14, 0.62, 0.14], offset: [0, -0.12, 0] },
      { size: [0.22, 0.12, 0.22], offset: [0, 0.24, 0] }
    ]);
  }

  if (id.includes("button")) {
    return boxesDescriptor([buttonBox(properties)]);
  }

  if (id.includes("ladder")) {
    return boxesDescriptor(ladderBoxes(properties));
  }

  if (id.includes("rail")) {
    return boxesDescriptor([{ size: [0.995, 0.05, 0.995], offset: [0, -0.48, 0] }]);
  }

  if (id.includes("lever")) {
    return boxesDescriptor([
      { size: [0.28, 0.08, 0.28], offset: [0, -0.46, 0] },
      { size: [0.12, 0.46, 0.12], offset: [0, -0.22, 0] }
    ]);
  }

  if (id.includes("pressure_plate")) {
    return boxesDescriptor([{ size: [0.78, 0.06, 0.78], offset: [0, -0.47, 0] }]);
  }

  if (id.includes("carpet")) {
    return boxesDescriptor([{ size: [0.995, 0.06, 0.995], offset: [0, -0.47, 0] }]);
  }

  if (id.includes("pane") || id.includes("bars")) {
    return boxesDescriptor(paneBoxes(properties));
  }

  if (id.includes("slab")) {
    if (properties.type === "double") {
      return boxesDescriptor([{ size: [0.995, 0.995, 0.995], offset: [0, 0, 0] }]);
    }
    return boxesDescriptor([
      { size: [0.995, 0.495, 0.995], offset: [0, properties.type === "top" ? 0.25 : -0.25, 0] }
    ]);
  }

  if (id.includes("stairs")) {
    return boxesDescriptor(stairBoxes(properties));
  }

  if (id.includes("fence") || id.includes("wall")) {
    return boxesDescriptor(postBoxes(properties));
  }

  if (id.includes("lantern")) {
    return boxesDescriptor([
      { size: [0.34, 0.48, 0.34], offset: [0, -0.08, 0] },
      { size: [0.18, 0.12, 0.18], offset: [0, 0.25, 0] }
    ]);
  }

  if (id.includes("chain")) {
    return boxesDescriptor([{ size: [0.18, 0.995, 0.18], offset: [0, 0, 0] }]);
  }

  if (id.includes("trapdoor")) {
    const open = properties.open === "true";
    const top = properties.half === "top";
    const vertical = trapdoorOpenBox(properties.facing || "north");
    return boxesDescriptor([{
      size: open ? vertical.size : [0.995, 0.16, 0.995],
      offset: open ? vertical.offset : [0, top ? 0.42 : -0.42, 0]
    }]);
  }

  if (id.includes("door")) {
    return boxesDescriptor([verticalFacingBox(properties.facing)]);
  }

  return boxesDescriptor([{ size: [0.995, 0.995, 0.995], offset: [0, 0, 0] }]);
}

/** @param {string} id */
export function shouldUseExplicitGeometry(id) {
  return isKnownNonFullBlock(id) ||
    id.includes("slab") || id.includes("stairs") || id.includes("pane") || id.includes("bars") ||
    id.includes("fence") || id.includes("wall") || id.includes("door") || id.includes("trapdoor") ||
    id.includes("lantern") || id.includes("chain");
}

/** @param {string} id */
export function isKnownNonFullBlock(id) {
  return isCrossPlant(id) || isCreatePipe(id) || isCreateColumn(id) ||
    id.includes("scaffolding") ||
    id.includes("valve") || id.includes("faucet") || id.includes("spout") || id.includes("nozzle") ||
    id.includes("torch") || id.includes("button") || id.includes("pressure_plate") || id.includes("carpet") ||
    id.includes("ladder") || id.includes("rail") || id.includes("sign") || id.includes("banner") ||
    id.includes("flower_pot") || id.includes("candle") || id.includes("lever") || id.includes("bell");
}

/**
 * @param {string} labelOrId Block-state label or bare block identifier.
 */
export function isOpaqueFullCube(labelOrId) {
  const id = String(labelOrId).split("[")[0].trim();
  if (isKnownNonFullBlock(id)) return false;
  if (id.includes("glass") || id.includes("pane") || id.includes("bars")) return false;
  if (id.includes("leaves") || id.includes("water") || id.includes("lava")) return false;
  if (id.includes("slab") || id.includes("stairs") || id.includes("fence") || id.includes("wall")) return false;
  if (id.includes("door") || id.includes("trapdoor") || id.includes("lantern") || id.includes("chain")) return false;
  return true;
}

/** @param {string} [facing] */
export function directionInfo(facing = "north") {
  const direction = DIRECTIONS[facing] || DIRECTIONS.north;
  return { ...direction, vector: [...direction.vector] };
}

function boxesDescriptor(boxes) {
  const fullUnit = boxes.length === 1 &&
    boxes[0].size.every((part) => part >= 0.98) &&
    boxes[0].offset.every((part) => Math.abs(part) < 0.01);

  if (boxes.length === 1) {
    return { type: "box", size: boxes[0].size, offset: boxes[0].offset, fullUnit };
  }

  return { type: "boxes", boxes, offset: [0, 0, 0], fullUnit };
}

function isCrossPlant(id) {
  return [
    "flower", "grass", "fern", "sapling", "bush", "mushroom", "roots", "sprouts", "crop",
    "wheat", "carrots", "potatoes", "beetroots", "nether_wart", "sugar_cane", "bamboo",
    "tulip", "dandelion", "poppy", "orchid", "allium", "azure_bluet", "cornflower",
    "lily_of_the_valley", "torchflower"
  ].some((part) => id.includes(part)) && !id.includes("grass_block");
}

function isCreatePipe(id) {
  return id.includes("pipe") || id.includes("tube") || id.includes("duct");
}

function isCreateColumn(id) {
  return id.includes("girder") || id.includes("shaft") || id.includes("cogwheel") ||
    id.includes("pole") || id.includes("post") || id.includes("beam") || id.includes("support") ||
    (id.startsWith("create:") && (id.includes("pillar") || id.includes("column")));
}

function pipeBoxes(properties) {
  const boxes = [{ size: [0.36, 0.36, 0.36], offset: [0, 0, 0] }];
  const hasConnection = ["north", "south", "east", "west", "up", "down"]
    .some((side) => connected(properties[side]));
  const connectAll = !hasConnection;

  if (connectAll || connected(properties.north)) boxes.push({ size: [0.26, 0.26, 0.5], offset: [0, 0, -0.25] });
  if (connectAll || connected(properties.south)) boxes.push({ size: [0.26, 0.26, 0.5], offset: [0, 0, 0.25] });
  if (connectAll || connected(properties.east)) boxes.push({ size: [0.5, 0.26, 0.26], offset: [0.25, 0, 0] });
  if (connectAll || connected(properties.west)) boxes.push({ size: [0.5, 0.26, 0.26], offset: [-0.25, 0, 0] });
  if (connectAll || connected(properties.up)) boxes.push({ size: [0.26, 0.5, 0.26], offset: [0, 0.25, 0] });
  if (connectAll || connected(properties.down)) boxes.push({ size: [0.26, 0.5, 0.26], offset: [0, -0.25, 0] });
  return boxes;
}

function columnBoxes(id, properties) {
  const axis = properties.axis || properties.facing_axis || inferAxisFromFacing(properties.facing) || (id.includes("shaft") ? "x" : "y");
  const girder = id.includes("girder") || id.includes("pillar") || id.includes("column");
  const thickness = girder ? 0.34 : 0.28;
  const main = axis === "x"
    ? { size: [0.995, thickness, thickness], offset: [0, 0, 0] }
    : axis === "z"
      ? { size: [thickness, thickness, 0.995], offset: [0, 0, 0] }
      : { size: [thickness, 0.995, thickness], offset: [0, 0, 0] };

  if (!girder) return [main];

  const cap = 0.46;
  if (axis === "x") {
    return [main, { size: [0.08, cap, cap], offset: [-0.46, 0, 0] }, { size: [0.08, cap, cap], offset: [0.46, 0, 0] }];
  }
  if (axis === "z") {
    return [main, { size: [cap, cap, 0.08], offset: [0, 0, -0.46] }, { size: [cap, cap, 0.08], offset: [0, 0, 0.46] }];
  }
  return [main, { size: [cap, 0.08, cap], offset: [0, -0.46, 0] }, { size: [cap, 0.08, cap], offset: [0, 0.46, 0] }];
}

function inferAxisFromFacing(facing) {
  if (facing === "east" || facing === "west") return "x";
  if (facing === "north" || facing === "south") return "z";
  if (facing === "up" || facing === "down") return "y";
  return null;
}

function buttonBox(properties) {
  const face = properties.face || "wall";
  if (face === "floor") return { size: [0.42, 0.08, 0.32], offset: [0, -0.46, 0] };
  if (face === "ceiling") return { size: [0.42, 0.08, 0.32], offset: [0, 0.46, 0] };
  return verticalFacingBox(properties.facing || "north", 0.1);
}

function trapdoorOpenBox(facing) {
  const direction = directionInfo(facing);
  const depth = 0.16;
  if (direction.axis === "x") {
    return { size: [depth, 0.995, 0.995], offset: [direction.sign * (0.5 - depth / 2), 0, 0] };
  }
  return { size: [0.995, 0.995, depth], offset: [0, 0, direction.sign * (0.5 - depth / 2)] };
}

function faucetBoxes(properties) {
  const facing = properties.facing || "north";
  const stem = verticalFacingBox(facing, 0.18);
  const head = facing === "east" || facing === "west"
    ? { size: [0.34, 0.26, 0.26], offset: [stem.offset[0] * 0.7, 0, 0] }
    : { size: [0.26, 0.26, 0.34], offset: [0, 0, stem.offset[2] * 0.7] };
  return [
    { size: stem.size, offset: stem.offset },
    head,
    { size: [0.18, 0.34, 0.18], offset: [0, -0.22, 0] }
  ];
}

function scaffoldBoxes() {
  const post = 0.12;
  return [
    { size: [post, 0.995, post], offset: [-0.42, 0, -0.42] },
    { size: [post, 0.995, post], offset: [0.42, 0, -0.42] },
    { size: [post, 0.995, post], offset: [-0.42, 0, 0.42] },
    { size: [post, 0.995, post], offset: [0.42, 0, 0.42] },
    { size: [0.995, 0.08, 0.995], offset: [0, 0.46, 0] }
  ];
}

function ladderBoxes(properties) {
  const face = verticalFacingBox(properties.facing || "north", 0.08);
  const rungDepth = face.size[0] < face.size[2] ? [0.08, 0.08, 0.76] : [0.76, 0.08, 0.08];
  const railDepth = face.size[0] < face.size[2] ? [0.08, 0.995, 0.08] : [0.08, 0.995, 0.08];
  const xWall = face.size[0] < face.size[2];
  return [
    { size: face.size, offset: face.offset },
    { size: rungDepth, offset: [face.offset[0], -0.24, face.offset[2]] },
    { size: rungDepth, offset: [face.offset[0], 0.05, face.offset[2]] },
    { size: rungDepth, offset: [face.offset[0], 0.34, face.offset[2]] },
    { size: railDepth, offset: xWall ? [face.offset[0], 0, -0.28] : [-0.28, 0, face.offset[2]] },
    { size: railDepth, offset: xWall ? [face.offset[0], 0, 0.28] : [0.28, 0, face.offset[2]] }
  ];
}

function connectionBox(side, zAxisSize, xAxisSize) {
  const direction = directionInfo(side);
  if (direction.axis === "x") {
    return { size: [...xAxisSize], offset: [direction.sign * 0.25, 0, 0] };
  }
  return { size: [...zAxisSize], offset: [0, 0, direction.sign * 0.25] };
}

function paneBoxes(properties) {
  const boxes = [{ size: [0.18, 0.995, 0.18], offset: [0, 0, 0] }];
  const any = CARDINALS.some((side) => properties[side] === "true");

  for (const side of CARDINALS) {
    if (properties[side] === "true") {
      boxes.push(connectionBox(side, [0.18, 0.995, 0.5], [0.5, 0.995, 0.18]));
    }
  }

  if (!any) {
    boxes.push({ size: [0.18, 0.995, 0.995], offset: [0, 0, 0] });
  }
  return boxes;
}

function stairBoxes(properties) {
  const top = properties.half === "top";
  const lowerY = top ? 0.25 : -0.25;
  const upperY = top ? -0.25 : 0.25;
  const facing = properties.facing || "north";
  const direction = directionInfo(facing);
  const upperOffset = direction.axis === "x"
    ? [direction.sign * 0.25, upperY, 0]
    : [0, upperY, direction.sign * 0.25];
  const upperSize = direction.axis === "x"
    ? [0.5, 0.495, 0.995]
    : [0.995, 0.495, 0.5];

  return [
    { size: [0.995, 0.495, 0.995], offset: [0, lowerY, 0] },
    { size: upperSize, offset: upperOffset }
  ];
}

function postBoxes(properties) {
  const boxes = [{ size: [0.28, 0.995, 0.28], offset: [0, 0, 0] }];
  for (const side of CARDINALS) {
    if (connected(properties[side])) {
      const box = connectionBox(side, [0.22, 0.76, 0.5], [0.5, 0.76, 0.22]);
      box.offset[1] = -0.08;
      boxes.push(box);
    }
  }
  return boxes;
}

function connected(value) {
  return value === "true" || value === "low" || value === "tall";
}

function verticalFacingBox(facing, depth = 0.16) {
  const direction = directionInfo(facing);
  const offset = direction.sign * (0.5 - depth / 2);
  if (direction.axis === "x") return { size: [depth, 0.995, 0.995], offset: [offset, 0, 0] };
  return { size: [0.995, 0.995, depth], offset: [0, 0, offset] };
}
