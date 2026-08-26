export const DEFAULT_ORIENTATION = Object.freeze({
  facingPreset: "invert-all",
  schematicYaw: 0,
  flipX: false,
  flipZ: false
});

const FACING_MAPS = Object.freeze({
  minecraft: Object.freeze({ north: "north", south: "south", east: "east", west: "west", up: "up", down: "down" }),
  "swap-ns": Object.freeze({ north: "south", south: "north", east: "east", west: "west", up: "up", down: "down" }),
  "swap-ew": Object.freeze({ north: "north", south: "south", east: "west", west: "east", up: "up", down: "down" }),
  "rotate-cw": Object.freeze({ north: "east", east: "south", south: "west", west: "north", up: "up", down: "down" }),
  "rotate-ccw": Object.freeze({ north: "west", west: "south", south: "east", east: "north", up: "up", down: "down" }),
  "invert-all": Object.freeze({ north: "south", south: "north", east: "west", west: "east", up: "up", down: "down" })
});

/**
 * Transform a schematic-space position using flip-before-yaw semantics.
 *
 * @param {{ x: number, y: number, z: number }} pos
 * @param {{ x?: number, z?: number } | null | undefined} size
 * @param {{ schematicYaw?: number, flipX?: boolean, flipZ?: boolean } | null | undefined} orientation
 * @returns {{ x: number, y: number, z: number }}
 */
export function orientedPosition(pos, size, orientation) {
  const dimensions = size || { x: 0, z: 0 };
  const transform = orientation || DEFAULT_ORIENTATION;
  let x = pos.x;
  let z = pos.z;

  if (transform.flipX) x = dimensions.x - 1 - x;
  if (transform.flipZ) z = dimensions.z - 1 - z;

  const yaw = Number(transform.schematicYaw || 0);
  if (yaw === 90) {
    return { x: dimensions.z - 1 - z, y: pos.y, z: x };
  }
  if (yaw === 180) {
    return { x: dimensions.x - 1 - x, y: pos.y, z: dimensions.z - 1 - z };
  }
  if (yaw === 270) {
    return { x: z, y: pos.y, z: dimensions.x - 1 - x };
  }
  return { x, y: pos.y, z };
}

/**
 * Map a block-facing value through an orientation preset.
 *
 * @param {string} facing
 * @param {string} preset
 * @returns {string}
 */
export function mapFacing(facing, preset) {
  return FACING_MAPS[preset]?.[facing] || facing;
}

/**
 * Remap directional block-state properties without mutating the input.
 *
 * @param {Record<string, string>} properties
 * @param {string} preset
 * @returns {Record<string, string>}
 */
export function mappedProperties(properties, preset) {
  const mapped = { ...properties };
  if (mapped.facing) {
    mapped.facing = mapFacing(mapped.facing, preset);
  }

  for (const [a, b] of [["north", "south"], ["east", "west"]]) {
    const mappedA = mapFacing(a, preset);
    const mappedB = mapFacing(b, preset);
    if (properties[a] !== undefined) mapped[mappedA] = properties[a];
    if (properties[b] !== undefined) mapped[mappedB] = properties[b];
  }
  return mapped;
}

/**
 * Build the portable orientation profile copied by the viewer UI.
 *
 * @param {{ facingPreset?: string, schematicYaw?: number, flipX?: boolean, flipZ?: boolean } | null | undefined} orientation
 * @returns {object}
 */
export function orientationProfile(orientation) {
  const selected = { ...DEFAULT_ORIENTATION, ...(orientation || {}) };
  return {
    type: "create-schematic-viewer-orientation",
    version: 1,
    note: "Use this as the default orientation profile for future schematics if this view matches Minecraft.",
    orientation: { ...selected },
    facingMap: {
      north: mapFacing("north", selected.facingPreset),
      south: mapFacing("south", selected.facingPreset),
      east: mapFacing("east", selected.facingPreset),
      west: mapFacing("west", selected.facingPreset),
      up: mapFacing("up", selected.facingPreset),
      down: mapFacing("down", selected.facingPreset)
    },
    schematicTransform: {
      yawDegrees: selected.schematicYaw,
      flipX: selected.flipX,
      flipZ: selected.flipZ
    }
  };
}
