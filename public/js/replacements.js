import { blockIdFromLabel } from "./schematic-data.js";

export const WOOD_TYPES = Object.freeze([
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

/**
 * Normalize a human-readable wood name for palette matching.
 *
 * @param {unknown} wood
 * @returns {string}
 */
export function woodToken(wood) {
  return String(wood).trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * Format a normalized wood name for display.
 *
 * @param {unknown} wood
 * @returns {string}
 */
export function woodLabel(wood) {
  return woodToken(wood).split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

/**
 * Replace every matching wood token in a block ID while retaining state data.
 *
 * @param {unknown} label
 * @param {unknown} sourceWood
 * @param {unknown} targetWood
 * @returns {string}
 */
export function replaceWoodInLabel(label, sourceWood, targetWood) {
  const text = String(label);
  const id = blockIdFromLabel(text);
  const nextId = id.replaceAll(woodToken(sourceWood), woodToken(targetWood));
  return `${nextId}${text.slice(id.length)}`;
}

/**
 * Return palette entries whose block ID contains the requested wood token.
 *
 * @param {{ blockCounts?: Array<{ label: string, count: number }> } | null | undefined} schematic
 * @param {unknown} sourceWood
 * @returns {Array<{ label: string, count: number }>}
 */
export function woodMatches(schematic, sourceWood) {
  if (!schematic) {
    return [];
  }
  const needle = woodToken(sourceWood);
  return schematic.blockCounts.filter((entry) => blockIdFromLabel(entry.label).includes(needle));
}
