/**
 * Return the namespaced block identifier from a palette label.
 *
 * @param {unknown} label
 * @returns {string}
 */
export function blockIdFromLabel(label) {
  return String(label).split("[")[0].trim();
}

/**
 * Parse the property suffix from a palette label.
 *
 * @param {unknown} label
 * @returns {Record<string, string>}
 */
export function propertiesFromLabel(label) {
  const match = String(label).match(/\[(.*)\]$/);
  if (!match) {
    return {};
  }

  return Object.fromEntries(
    match[1]
      .split(",")
      .map((part) => part.split("="))
      .filter(([key, value]) => key && value !== undefined)
  );
}

/**
 * Build the compact key used by the renderer's occupancy maps.
 *
 * @param {unknown} x
 * @param {unknown} y
 * @param {unknown} z
 * @returns {string}
 */
export function positionKey(x, y, z) {
  return `${x},${y},${z}`;
}

/**
 * Create a filesystem-friendly base name while retaining the current naming
 * behavior used by item-list downloads.
 *
 * @param {unknown} fileName
 * @returns {string}
 */
export function baseFileName(fileName) {
  return String(fileName)
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "schematic";
}

/**
 * Name a replacement export without changing its original extension.
 *
 * @param {unknown} fileName
 * @returns {string}
 */
export function modifiedFileName(fileName) {
  const match = String(fileName).match(/^(.*?)(\.[^.]+)?$/);
  const base = match?.[1] || "schematic";
  const extension = match?.[2] || ".nbt";
  return `${base}-modified${extension}`;
}

/**
 * Detect the gzip signature used by compressed NBT files.
 *
 * @param {ArrayLike<number>} bytes
 * @returns {boolean}
 */
export function isGzipNbt(bytes) {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Encode binary data without depending on browser globals or Node APIs.
 *
 * @param {ArrayBuffer | ArrayBufferView | ArrayLike<number>} buffer
 * @returns {string}
 */
export function arrayBufferToBase64(buffer) {
  const bytes = toUint8Array(buffer);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let encoded = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1] : 0;
    const third = hasThird ? bytes[index + 2] : 0;
    const value = (first << 16) | (second << 8) | third;

    encoded += alphabet[(value >>> 18) & 0x3f];
    encoded += alphabet[(value >>> 12) & 0x3f];
    encoded += hasSecond ? alphabet[(value >>> 6) & 0x3f] : "=";
    encoded += hasThird ? alphabet[value & 0x3f] : "=";
  }

  return encoded;
}

/**
 * Aggregate a schematic palette after applying preview replacements.
 *
 * @param {{ blockCounts?: Array<{ label: string, count: number }> } | null | undefined} schematic
 * @param {Map<string, string>} [replacements]
 * @returns {Array<{ id: string, state: string, count: number, stacks: number, remainder: number }>}
 */
export function itemListRows(schematic, replacements = new Map()) {
  if (!schematic) {
    return [];
  }

  const counts = new Map();
  for (const entry of schematic.blockCounts) {
    const label = replacements.get(entry.label) || entry.label;
    counts.set(label, (counts.get(label) || 0) + entry.count);
  }

  return [...counts.entries()]
    .map(([stateLabel, count]) => ({
      id: blockIdFromLabel(stateLabel),
      state: stateLabel,
      count,
      stacks: Math.floor(count / 64),
      remainder: count % 64
    }))
    .sort((a, b) => b.count - a.count || a.state.localeCompare(b.state));
}

/**
 * Serialize item-list rows as RFC 4180-style CSV.
 *
 * @param {Array<{ id: string, state: string, count: number, stacks: number, remainder: number }>} rows
 * @returns {string}
 */
export function itemListCsv(rows) {
  const header = ["block_id", "block_state", "count", "stacks_64", "remainder"];
  return [header, ...rows.map((row) => [row.id, row.state, row.count, row.stacks, row.remainder])]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

/**
 * Serialize item-list rows for console and plain-text downloads.
 *
 * @param {Array<{ state: string, count: number, stacks: number, remainder: number }>} rows
 * @param {unknown} [fileName]
 * @returns {string}
 */
export function itemListText(rows, fileName = "schematic") {
  const title = `Item list for ${fileName || "schematic"}`;
  return [
    title,
    "=".repeat(title.length),
    ...rows.map((row) => `${row.count.toLocaleString().padStart(7)}  ${String(row.stacks).padStart(4)}x64 + ${String(row.remainder).padStart(2)}  ${row.state}`)
  ].join("\n");
}

/**
 * Escape one CSV cell only when delimiters require it.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toUint8Array(value) {
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return Uint8Array.from(value);
}
