import { createApiClient } from "./js/api-client.js";
import { createLibraryClient } from "./js/library-client.js";
import {
  blockShape,
  isOpaqueFullCube,
  shouldUseExplicitGeometry
} from "./js/block-shapes.js";
import {
  arrayBufferToBase64,
  baseFileName,
  blockIdFromLabel,
  isGzipNbt,
  itemListCsv,
  itemListRows,
  itemListText,
  modifiedFileName,
  positionKey,
  propertiesFromLabel
} from "./js/schematic-data.js";
import {
  DEFAULT_ORIENTATION,
  mappedProperties,
  orientationProfile,
  orientedPosition
} from "./js/orientation.js";
import {
  replaceWoodInLabel,
  WOOD_TYPES,
  woodLabel,
  woodMatches
} from "./js/replacements.js";

const api = createApiClient();
const libraryApi = createLibraryClient();

const elements = {
  fileInput: document.querySelector("#fileInput"),
  litematicInput: document.querySelector("#litematicInput"),
  convertLitematic: document.querySelector("#convertLitematic"),
  converterSplitMode: document.querySelector("#converterSplitMode"),
  converterSplitKb: document.querySelector("#converterSplitKb"),
  loadConverted: document.querySelector("#loadConverted"),
  showConverterLog: document.querySelector("#showConverterLog"),
  downloadConverted: document.querySelector("#downloadConverted"),
  converterStatus: document.querySelector("#converterStatus"),
  assetAdminPanel: document.querySelector("#assetAdminPanel"),
  assetPackInput: document.querySelector("#assetPackInput"),
  assetPackLoader: document.querySelector("#assetPackLoader"),
  assetStats: document.querySelector("#assetStats"),
  assetPackList: document.querySelector("#assetPackList"),
  dropZone: document.querySelector("#dropZone"),
  stats: document.querySelector("#stats"),
  warnings: document.querySelector("#warnings"),
  viewer: document.querySelector("#viewer"),
  viewerTitle: document.querySelector("#viewerTitle"),
  viewerSubtitle: document.querySelector("#viewerSubtitle"),
  hoverReadout: document.querySelector("#hoverReadout"),
  paletteList: document.querySelector("#paletteList"),
  layerSlider: document.querySelector("#layerSlider"),
  layerLabel: document.querySelector("#layerLabel"),
  hologramToggle: document.querySelector("#hologramToggle"),
  opacitySlider: document.querySelector("#opacitySlider"),
  opacityLabel: document.querySelector("#opacityLabel"),
  glassOpacitySlider: document.querySelector("#glassOpacitySlider"),
  glassOpacityLabel: document.querySelector("#glassOpacityLabel"),
  gridToggle: document.querySelector("#gridToggle"),
  textureToggle: document.querySelector("#textureToggle"),
  textureStatus: document.querySelector("#textureStatus"),
  facingPreset: document.querySelector("#facingPreset"),
  schematicYaw: document.querySelector("#schematicYaw"),
  flipXToggle: document.querySelector("#flipXToggle"),
  flipZToggle: document.querySelector("#flipZToggle"),
  copyOrientation: document.querySelector("#copyOrientation"),
  orientationStatus: document.querySelector("#orientationStatus"),
  resetCamera: document.querySelector("#resetCamera"),
  showAllLayers: document.querySelector("#showAllLayers"),
  sourceBlock: document.querySelector("#sourceBlock"),
  replacementBlock: document.querySelector("#replacementBlock"),
  replaceBlock: document.querySelector("#replaceBlock"),
  woodSource: document.querySelector("#woodSource"),
  woodTarget: document.querySelector("#woodTarget"),
  woodMatchList: document.querySelector("#woodMatchList"),
  previewWoodSwap: document.querySelector("#previewWoodSwap"),
  writeReplacements: document.querySelector("#writeReplacements"),
  showReplacementLog: document.querySelector("#showReplacementLog"),
  downloadModified: document.querySelector("#downloadModified"),
  replacementStatus: document.querySelector("#replacementStatus"),
  itemExportFormat: document.querySelector("#itemExportFormat"),
  exportItemList: document.querySelector("#exportItemList"),
  printItemList: document.querySelector("#printItemList"),
  downloadItemList: document.querySelector("#downloadItemList"),
  itemExportStatus: document.querySelector("#itemExportStatus")
};

const state = {
  schematic: null,
  currentFileName: "",
  sourceBytes: null,
  activeLayer: null,
  replacements: new Map(),
  meshGroups: [],
  blockLookup: [],
  renderToken: 0,
  assetPack: null,
  convertedFile: null,
  convertedUrl: null,
  modifiedUrl: null,
  itemListUrl: null,
  logs: {
    converter: "",
    replacements: ""
  },
  needsRender: true,
  isBuildingScene: false,
  lastRenderSignature: "",
  orientation: { ...DEFAULT_ORIENTATION }
};

const SPLIT_KB_STORAGE_KEY = "createSchematicViewer.splitMaxKb";

const scene = new THREE.Scene();
scene.background = new THREE.Color("#10130f");

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 4000);
camera.position.set(30, 26, 36);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
elements.viewer.append(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(-2, -2);
let grid = null;

scene.add(new THREE.HemisphereLight("#f3ffe8", "#263026", 2.1));
const sun = new THREE.DirectionalLight("#ffffff", 2.2);
sun.position.set(30, 60, 25);
scene.add(sun);

const matrix = new THREE.Matrix4();
const colorScratch = new THREE.Color();
const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin("anonymous");
const textureCache = new Map();
const geometryCache = new Map();
const remoteModelCache = new Map();
const materialCache = new Map();

function resize() {
  const width = elements.viewer.clientWidth;
  const height = elements.viewer.clientHeight;
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  requestSceneRender();
}

function animate() {
  requestAnimationFrame(animate);
  const changed = controls.update();
  if (changed || state.needsRender || state.isBuildingScene) {
    renderer.render(scene, camera);
    state.needsRender = false;
  }
}

async function loadFile(file) {
  setBusy(`Reading ${file.name}...`);
  const bytes = await file.arrayBuffer();
  state.schematic = await parseSchematicFile(bytes);
  state.currentFileName = file.name;
  state.sourceBytes = bytes;
  state.activeLayer = null;
  state.replacements.clear();
  clearModifiedDownload();
  updateInspector();
  renderSchematic();
}

async function loadAssetPack(file) {
  updateAssetStats({ name: `Loading ${file.name}...`, textures: "-", models: "-", blockstates: "-", namespaces: [] });
  const payload = await api.loadAssetPack({
    fileName: file.name,
    bytes: await file.arrayBuffer()
  });

  state.assetPack = payload;
  textureCache.clear();
  remoteModelCache.clear();
  materialCache.clear();
  updateAssetStats(payload);
  if (state.schematic) {
    renderSchematic();
    updatePaletteList();
  }
}

function setLibraryStatus(message, kind) {
  const status = document.querySelector("#libraryStatus");
  if (!status) return;
  status.textContent = message;
  status.dataset.kind = kind;
}

async function addCurrentSchematicToLibrary() {
  if (!state.sourceBytes || !state.schematic || !state.currentFileName) {
    throw new Error("Load a schematic before adding it to the shared library.");
  }
  if (!state.currentFileName.toLowerCase().endsWith(".nbt")) {
    throw new Error("Convert this schematic to .nbt before adding it to the shared library.");
  }

  const title = baseFileName(state.currentFileName).replace(/[_-]+/g, " ").trim() || "Untitled schematic";
  return libraryApi.importSchematic({
    bytes: state.sourceBytes,
    fileName: state.currentFileName,
    title,
    metadata: {
      tags: state.schematic.palette.some((entry) => String(entry.name || "").startsWith("create:")) ? ["create"] : []
    }
  });
}

async function convertLitematicFile(file) {
  elements.converterStatus.textContent = `Converting ${file.name}...`;
  const splitMode = elements.converterSplitMode.value;
  const splitMaxKb = normalizedSplitKb();
  let result;
  try {
    result = await api.convert({
      fileName: file.name,
      bytes: await file.arrayBuffer(),
      splitMode,
      splitMaxKb
    });
  } catch (error) {
    setOperationLog("converter", `Conversion failed for ${file.name}\n\n${error.message}`);
    throw error;
  }

  const { blob, outputKind, modeUsed, splitKbUsed } = result;
  setOperationLog("converter", result.log || `Converted ${file.name}; converter produced no stdout.`);
  const baseName = file.name.replace(/\.(litematic|schem)$/i, "") || "converted";
  const convertedName = outputKind === "zip" ? `${baseName}_parts.zip` : `${baseName}.nbt`;

  if (state.convertedUrl) {
    URL.revokeObjectURL(state.convertedUrl);
  }
  state.convertedFile = outputKind === "zip"
    ? null
    : new File([blob], convertedName, { type: "application/octet-stream" });
  state.convertedUrl = URL.createObjectURL(blob);
  elements.downloadConverted.href = state.convertedUrl;
  elements.downloadConverted.download = convertedName;
  elements.downloadConverted.hidden = false;
  elements.loadConverted.disabled = outputKind === "zip";
  elements.converterStatus.textContent = outputKind === "zip"
    ? `Converted with ${modeUsed} mode (${splitKbUsed} KB) into ${convertedName}.`
    : `Converted with ${modeUsed} mode (${splitKbUsed} KB) into ${convertedName}.`;
}

function updateAssetStats(summary) {
  elements.assetStats.innerHTML = `
    <div><dt>Packs</dt><dd>${escapeHtml(summary.packs?.length ?? (summary.name ? 1 : 0))}</dd></div>
    <div><dt>Textures</dt><dd>${escapeHtml(summary.textures ?? 0)}</dd></div>
    <div><dt>Models</dt><dd>${escapeHtml(summary.models ?? 0)}</dd></div>
    <div><dt>Blockstates</dt><dd>${escapeHtml(summary.blockstates ?? 0)}</dd></div>
    <div><dt>Namespaces</dt><dd>${escapeHtml((summary.namespaces || []).join(", ") || "-")}</dd></div>
  `;
  elements.assetPackList.innerHTML = (summary.packs || [])
    .map((pack, index) => `
      <div class="asset-pack-row">
        <span title="${escapeHtml(pack.name)}">${index + 1}. ${escapeHtml(pack.name)}</span>
        <span>${Number(pack.textures || 0).toLocaleString()} tex</span>
      </div>
    `)
    .join("");
}

async function parseSchematicFile(bytes) {
  return api.parseSchematic(bytes);
}

function updateInspector() {
  const schematic = state.schematic;
  const size = schematic.size || { x: 0, y: 0, z: 0 };
  const dimensions = `${size.x} x ${size.y} x ${size.z}`;
  elements.viewerTitle.textContent = state.currentFileName;
  elements.viewerSubtitle.textContent = `${schematic.totalBlocks.toLocaleString()} block entries, ${schematic.palette.length.toLocaleString()} palette states`;

  elements.stats.innerHTML = `
    <div><dt>File</dt><dd>${escapeHtml(state.currentFileName)}</dd></div>
    <div><dt>Blocks</dt><dd>${schematic.visibleBlocks.toLocaleString()} visible / ${schematic.totalBlocks.toLocaleString()} total</dd></div>
    <div><dt>Palette</dt><dd>${schematic.palette.length.toLocaleString()} states</dd></div>
    <div><dt>Size</dt><dd>${dimensions}</dd></div>
    <div><dt>Entities</dt><dd>${schematic.entities.toLocaleString()}</dd></div>
  `;

  elements.warnings.innerHTML = schematic.warnings.map((warning) => `<div class="warning">${escapeHtml(warning)}</div>`).join("");

  const maxLayer = Math.max(0, size.y - 1);
  elements.layerSlider.disabled = false;
  elements.layerSlider.max = String(maxLayer);
  elements.layerSlider.value = String(maxLayer);
  elements.layerLabel.textContent = "All";

  elements.sourceBlock.disabled = false;
  elements.replacementBlock.disabled = false;
  elements.replaceBlock.disabled = false;
  elements.woodSource.disabled = false;
  elements.woodTarget.disabled = false;
  elements.previewWoodSwap.disabled = false;
  elements.writeReplacements.disabled = state.replacements.size === 0;
  elements.exportItemList.disabled = false;
  elements.printItemList.disabled = false;
  elements.sourceBlock.innerHTML = schematic.blockCounts
    .map((entry) => `<option value="${escapeHtml(entry.label)}">${escapeHtml(entry.label)} (${entry.count})</option>`)
    .join("");
  updateWoodFamilyControls();

  updatePaletteList();
}

function downloadItemList() {
  const rows = itemListRows(state.schematic, state.replacements);
  if (!rows.length) {
    elements.itemExportStatus.textContent = "No blocks are available to export.";
    return;
  }

  if (state.itemListUrl) {
    URL.revokeObjectURL(state.itemListUrl);
  }
  const format = elements.itemExportFormat.value === "txt" ? "txt" : "csv";
  const content = format === "txt" ? itemListText(rows, state.currentFileName) : itemListCsv(rows);
  const mime = format === "txt" ? "text/plain;charset=utf-8" : "text/csv;charset=utf-8";
  const fileName = `${baseFileName(state.currentFileName || "schematic")}_item_list.${format}`;
  state.itemListUrl = URL.createObjectURL(new Blob([content], { type: mime }));
  elements.downloadItemList.href = state.itemListUrl;
  elements.downloadItemList.download = fileName;
  elements.downloadItemList.hidden = false;
  elements.downloadItemList.click();
  elements.itemExportStatus.textContent = `Exported ${rows.length.toLocaleString()} item rows as ${format.toUpperCase()}.`;
}

function printItemListToConsole() {
  const rows = itemListRows(state.schematic, state.replacements);
  if (!rows.length) {
    elements.itemExportStatus.textContent = "No blocks are available to print.";
    return;
  }

  const text = itemListText(rows, state.currentFileName);
  console.info("[create-schematic-viewer:item-list]\n%s", text);
  elements.itemExportStatus.textContent = "Item list printed to the browser console.";
}

function updatePaletteList() {
  const schematic = state.schematic;
  if (!schematic) {
    elements.paletteList.innerHTML = "";
    return;
  }

  elements.paletteList.innerHTML = schematic.blockCounts
    .map((entry) => {
      const color = blockColor(entry.label).getStyle();
      const replacement = state.replacements.get(entry.label);
      const label = replacement ? `${entry.label} -> ${replacement}` : entry.label;
      const iconUrl = blockIconUrl(label);
      return `
        <div class="palette-row">
          ${elements.textureToggle.checked
            ? `<img class="swatch" src="${iconUrl}" alt="" loading="lazy">`
            : `<span class="swatch" style="background:${color}"></span>`}
          <span class="palette-name" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
          <span class="count">${entry.count.toLocaleString()}</span>
        </div>
      `;
    })
    .join("");

  for (const image of elements.paletteList.querySelectorAll("img.swatch")) {
    image.addEventListener("error", () => {
      const fallback = document.createElement("span");
      fallback.className = "swatch";
      image.replaceWith(fallback);
    }, { once: true });
  }
}

function updateWoodFamilyControls() {
  const previousSource = elements.woodSource.value || "spruce";
  const previousTarget = elements.woodTarget.value || "oak";
  elements.woodSource.innerHTML = WOOD_TYPES
    .map((wood) => `<option value="${wood}">${woodLabel(wood)}</option>`)
    .join("");
  elements.woodTarget.innerHTML = WOOD_TYPES
    .map((wood) => `<option value="${wood}">${woodLabel(wood)}</option>`)
    .join("");

  elements.woodSource.value = WOOD_TYPES.includes(previousSource) ? previousSource : "spruce";
  elements.woodTarget.value = WOOD_TYPES.includes(previousTarget) ? previousTarget : "oak";
  if (elements.woodSource.value === elements.woodTarget.value) {
    elements.woodTarget.value = elements.woodSource.value === "oak" ? "spruce" : "oak";
  }
  renderWoodMatchList();
}

function renderWoodMatchList() {
  const sourceWood = elements.woodSource.value || "spruce";
  const targetWood = elements.woodTarget.value || "oak";
  const matches = woodMatches(state.schematic, sourceWood);

  if (!state.schematic) {
    elements.woodMatchList.innerHTML = "";
    elements.replacementStatus.textContent = "Pick a loaded schematic to build wood-family replacements.";
    return;
  }

  if (!matches.length) {
    elements.woodMatchList.innerHTML = `<div class="empty-state">No ${escapeHtml(woodLabel(sourceWood))} blocks found in this schematic.</div>`;
    elements.replacementStatus.textContent = `No ${woodLabel(sourceWood)} palette entries found.`;
    return;
  }

  elements.woodMatchList.innerHTML = matches
    .map((entry) => {
      const target = replaceWoodInLabel(entry.label, sourceWood, targetWood);
      return `
        <label class="wood-match">
          <input type="checkbox" value="${escapeHtml(entry.label)}" checked>
          <span title="${escapeHtml(entry.label)}">${escapeHtml(entry.label)}</span>
          <strong title="${escapeHtml(target)}">${escapeHtml(target)}</strong>
          <em>${entry.count.toLocaleString()}</em>
        </label>
      `;
    })
    .join("");
  elements.replacementStatus.textContent = `${matches.length.toLocaleString()} ${woodLabel(sourceWood)} palette entries ready to preview.`;
}

function checkedWoodLabels() {
  return [...elements.woodMatchList.querySelectorAll("input[type='checkbox']:checked")]
    .map((input) => input.value);
}

function previewWoodSwap() {
  const sourceWood = elements.woodSource.value || "spruce";
  const targetWood = elements.woodTarget.value || "oak";
  const selected = checkedWoodLabels();
  for (const label of selected) {
    state.replacements.set(label, replaceWoodInLabel(label, sourceWood, targetWood));
  }
  elements.writeReplacements.disabled = state.replacements.size === 0;
  elements.replacementStatus.textContent = `Previewing ${selected.length.toLocaleString()} wood-family replacements.`;
  updatePaletteList();
  renderSchematic();
}

function loadSplitKbPreference() {
  const stored = localStorage.getItem(SPLIT_KB_STORAGE_KEY);
  if (stored && Number(stored) > 0) {
    elements.converterSplitKb.value = String(Math.floor(Number(stored)));
  }
}

function normalizedSplitKb() {
  const value = Math.max(1, Math.floor(Number(elements.converterSplitKb.value) || 512));
  elements.converterSplitKb.value = String(value);
  localStorage.setItem(SPLIT_KB_STORAGE_KEY, String(value));
  return String(value);
}

async function writeReplacementFile() {
  if (!state.sourceBytes || !state.currentFileName) {
    throw new Error("Load a schematic before writing replacements.");
  }
  if (!state.replacements.size) {
    throw new Error("Preview at least one replacement before writing changes.");
  }
  clearModifiedDownload();
  elements.replacementStatus.textContent = "Writing modified schematic...";
  let result;
  try {
    result = await api.writeReplacements({
      fileName: state.currentFileName,
      file: arrayBufferToBase64(state.sourceBytes),
      replacements: [...state.replacements.entries()].map(([from, to]) => ({ from, to }))
    });
  } catch (error) {
    setOperationLog("replacements", `Replacement export failed for ${state.currentFileName}\n\n${error.message}`);
    throw error;
  }

  setOperationLog("replacements", result.log || `Wrote replacements for ${state.currentFileName}; writer produced no stdout.`);
  const { bytes } = result;
  if (!isGzipNbt(bytes)) {
    const preview = new TextDecoder().decode(bytes.slice(0, 240));
    throw new Error(`Replacement export did not return a gzip NBT file. ${preview.trim()}`);
  }

  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const modifiedName = modifiedFileName(state.currentFileName);
  if (state.modifiedUrl) {
    URL.revokeObjectURL(state.modifiedUrl);
  }
  state.modifiedUrl = URL.createObjectURL(blob);
  elements.downloadModified.href = state.modifiedUrl;
  elements.downloadModified.download = modifiedName;
  elements.downloadModified.hidden = false;
  elements.replacementStatus.textContent = `Wrote ${modifiedName}.`;
}

function clearModifiedDownload() {
  if (state.modifiedUrl) {
    URL.revokeObjectURL(state.modifiedUrl);
  }
  state.modifiedUrl = null;
  elements.downloadModified.removeAttribute("href");
  elements.downloadModified.removeAttribute("download");
  elements.downloadModified.hidden = true;
  elements.writeReplacements.disabled = true;
}

function setOperationLog(kind, message) {
  state.logs[kind] = message || "";
}

function showOperationLog(kind) {
  const text = state.logs[kind] || "";
  const target = kind === "converter" ? elements.converterStatus : elements.replacementStatus;
  if (!text) {
    target.textContent = "No log is available yet.";
  }

  console.info(`[create-schematic-viewer:${kind}]\n%s`, text || "No log is available yet.");
}

async function renderSchematic() {
  const renderToken = ++state.renderToken;
  state.isBuildingScene = true;
  clearSceneMeshes();
  const schematic = state.schematic;
  if (!schematic) {
    state.isBuildingScene = false;
    return;
  }

  const visibleBlocks = schematic.blocks.filter((block) => {
    if (block.name === "minecraft:air" || block.name === "air") {
      return false;
    }
    return state.activeLayer === null || block.pos.y <= state.activeLayer;
  });

  const groups = new Map();
  const solidOccupancy = new Set();
  visibleBlocks.forEach((block) => {
    const label = state.replacements.get(block.label) || block.label;
    const orientedPos = orientedPosition(block.pos, schematic.size, state.orientation);
    const renderBlock = { ...block, pos: orientedPos };
    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label).push(renderBlock);

    if (isOpaqueFullCube(label)) {
      solidOccupancy.add(positionKey(orientedPos.x, orientedPos.y, orientedPos.z));
    }
  });

  state.blockLookup = [];
  updateTextureStatus(elements.textureToggle.checked
    ? "Loading local face textures for 3D blocks..."
    : "Local face textures are off. 3D uses generated block materials.");
  const materialEntries = await Promise.all([...groups.keys()].map(async (label) => [label, await materialForBlock(label)]));
  const materialsByLabel = new Map(materialEntries);
  if (renderToken !== state.renderToken) {
    state.isBuildingScene = false;
    return;
  }

  for (const [label, blocks] of groups) {
    const { material, textured, faceMaterials } = materialsByLabel.get(label);

    if (isOpaqueFullCube(label)) {
      const mesh = faceCulledMesh(label, blocks, material, solidOccupancy, faceMaterials);
      scene.add(mesh);
      state.meshGroups.push(mesh);
      requestSceneRender();
      continue;
    }

    const shape = await geometryForBlock(label);
    if (renderToken !== state.renderToken) {
      return;
    }
    const mesh = new THREE.InstancedMesh(shape.geometry, material, blocks.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.blocks = blocks;
    mesh.userData.label = label;

    blocks.forEach((block, index) => {
      matrix.makeTranslation(
        block.pos.x + shape.offset.x,
        block.pos.y + shape.offset.y,
        block.pos.z + shape.offset.z
      );
      mesh.setMatrixAt(index, matrix);
      if (!textured) {
        colorScratch.copy(blockColor(label)).multiplyScalar(0.78 + ((block.pos.x + block.pos.y + block.pos.z) % 5) * 0.045);
        mesh.setColorAt(index, colorScratch);
      }
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    scene.add(mesh);
    state.meshGroups.push(mesh);
    requestSceneRender();
  }

  addGrid();
  resetCameraToSchematic();
  updateTextureStatus(elements.textureToggle.checked
    ? `Local face textures applied where loaded assets resolve them for ${groups.size.toLocaleString()} block types. Missing local textures use generated materials.`
    : "3D textures are off; using generated colors with solid interior face culling.");
  state.isBuildingScene = false;
  requestSceneRender();
}

function clearSceneMeshes() {
  for (const mesh of state.meshGroups) {
    scene.remove(mesh);
    mesh.geometry.dispose?.();
  }
  state.meshGroups = [];
  requestSceneRender();
}

function addGrid() {
  if (grid) {
    scene.remove(grid);
    grid.dispose?.();
    grid = null;
  }

  if (!elements.gridToggle.checked || !state.schematic) {
    return;
  }

  const size = state.schematic.size || { x: 16, z: 16 };
  const gridSize = Math.max(size.x, size.z, 8);
  grid = new THREE.GridHelper(gridSize + 2, gridSize + 2, "#527052", "#263226");
  grid.position.set((size.x - 1) / 2, -0.52, (size.z - 1) / 2);
  scene.add(grid);
}

function resetCameraToSchematic() {
  if (!state.schematic) {
    return;
  }

  const size = state.schematic.size || { x: 16, y: 16, z: 16 };
  const center = new THREE.Vector3((size.x - 1) / 2, (size.y - 1) / 2, (size.z - 1) / 2);
  const radius = Math.max(size.x, size.y, size.z, 8);
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(radius * 1.25, radius * 0.92, radius * 1.4));
  camera.near = 0.1;
  camera.far = Math.max(4000, radius * 12);
  camera.updateProjectionMatrix();
  controls.update();
}

function blockColor(label) {
  const name = label.split("[")[0];
  const known = [
    ["grass", "#5ea447"],
    ["dirt", "#79543a"],
    ["stone", "#8e9391"],
    ["deepslate", "#4b4d53"],
    ["cobble", "#777b79"],
    ["sand", "#d8c680"],
    ["glass", "#9fd6e9"],
    ["water", "#387bd8"],
    ["lava", "#e96b22"],
    ["log", "#86613b"],
    ["wood", "#9a7045"],
    ["planks", "#b88750"],
    ["leaves", "#4f8f3d"],
    ["wool", "#d8d8d8"],
    ["copper", "#c76f4b"],
    ["brass", "#c9a34e"],
    ["andesite", "#9ca09b"],
    ["train", "#565d66"],
    ["casing", "#9f7a4b"],
    ["shaft", "#7d7f86"],
    ["gear", "#a8864a"]
  ];

  const match = known.find(([part]) => name.includes(part));
  if (match) {
    return new THREE.Color(match[1]);
  }

  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  const hue = hash % 360;
  return new THREE.Color(`hsl(${hue}, 42%, 54%)`);
}

async function materialForBlock(label) {
  const opacity = opacityForBlock(label);
  const id = blockIdFromLabel(label);
  const materialKey = JSON.stringify({
    id,
    textured: elements.textureToggle.checked,
    opacity,
    explicit: shouldUseExplicitGeometry(id)
  });
  if (materialCache.has(materialKey)) {
    return materialCache.get(materialKey);
  }

  const baseOptions = {
    color: blockColor(label),
    transparent: opacity < 1,
    opacity,
    roughness: 0.82,
    metalness: 0.02,
    side: shouldUseExplicitGeometry(id) ? THREE.DoubleSide : THREE.FrontSide
  };

  if (!elements.textureToggle.checked) {
    const result = {
      material: new THREE.MeshStandardMaterial(baseOptions),
      textured: false,
      faceMaterials: false
    };
    materialCache.set(materialKey, result);
    return result;
  }

  try {
    const textureSet = await loadBlockTextureSet(label);
    const materialSet = materialSetFromTextures(textureSet, baseOptions, isOpaqueFullCube(label));

    const result = {
      material: materialSet,
      textured: true,
      faceMaterials: Array.isArray(materialSet)
    };
    materialCache.set(materialKey, result);
    return result;
  } catch {
    const result = {
      material: new THREE.MeshStandardMaterial(baseOptions),
      textured: false,
      faceMaterials: false
    };
    materialCache.set(materialKey, result);
    return result;
  }
}

function opacityForBlock(label) {
  if (!elements.hologramToggle.checked) {
    return 1;
  }

  const id = blockIdFromLabel(label);
  const value = id.includes("glass") || id.includes("pane")
    ? Number(elements.glassOpacitySlider.value)
    : Number(elements.opacitySlider.value);
  return Math.max(0.1, Math.min(1, value / 100));
}

function materialSetFromTextures(textureSet, baseOptions, useFaceMaterials) {
  const make = (texture) => new THREE.MeshStandardMaterial({
    ...baseOptions,
    color: "#ffffff",
    map: texture,
    transparent: true,
    alphaTest: 0.1
  });

  const fallback = textureSet.all || textureSet.north || textureSet.south || textureSet.east || textureSet.west || textureSet.up || textureSet.down;

  if (useFaceMaterials && (textureSet.east || textureSet.west || textureSet.up || textureSet.down || textureSet.south || textureSet.north)) {
    return [
      make(textureSet.east || fallback),
      make(textureSet.west || fallback),
      make(textureSet.up || fallback),
      make(textureSet.down || fallback),
      make(textureSet.south || fallback),
      make(textureSet.north || fallback)
    ];
  }

  return make(fallback);
}

function loadBlockTexture(label) {
  const id = blockIdFromLabel(label);
  if (textureCache.has(id)) {
    return textureCache.get(id);
  }

  const promise = new Promise((resolve, reject) => {
    textureLoader.load(blockIconUrl(label), resolve, undefined, reject);
  });
  textureCache.set(id, promise);
  return promise;
}

async function loadBlockTextureSet(label) {
  const id = blockIdFromLabel(label);
  const textureSet = await loadLocalBlockTextureSet(id);
  if (!textureSet) {
    throw new Error("No local face textures loaded for this block.");
  }
  return textureSet;
}

async function loadLocalBlockTextureSet(blockId) {
  if (!(location.protocol === "http:" || location.protocol === "https:")) {
    return null;
  }

  const cacheKey = `local:${blockId}`;
  if (textureCache.has(cacheKey)) {
    return textureCache.get(cacheKey);
  }

  const promise = fetch(`./api/assets/blocks/${encodeURIComponent(blockId)}/textures`)
    .then(async (response) => {
      if (!response.ok) {
        return null;
      }
      const payload = await response.json();
      if (!payload.found) {
        return null;
      }
      const url = payload.textures.all?.url || payload.textures.north?.url || payload.textures.up?.url;
      if (!url) {
        return null;
      }
      const textures = {};
      for (const [face, data] of Object.entries(payload.textures)) {
        textures[face] = await loadTextureUrl(data.url);
      }
      return textures;
    })
    .catch(() => null);

  textureCache.set(cacheKey, promise);
  return promise;
}

function loadTextureUrl(url) {
  if (textureCache.has(url)) {
    return textureCache.get(url);
  }

  const promise = new Promise((resolve, reject) => {
    textureLoader.load(url, (texture) => {
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestMipmapNearestFilter;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
      resolve(texture);
    }, undefined, reject);
  });
  textureCache.set(url, promise);
  return promise;
}

async function geometryForBlock(label) {
  const id = blockIdFromLabel(label);
  const properties = mappedProperties(propertiesFromLabel(label), state.orientation.facingPreset);
  const key = `${id}|${JSON.stringify(properties)}|${JSON.stringify(state.orientation)}`;

  if (!geometryCache.has(key)) {
    if (shouldUseExplicitGeometry(id)) {
      geometryCache.set(key, createGeometryForBlock(id, properties));
      return geometryCache.get(key);
    }

    const remoteShape = await remoteModelGeometry(id);
    if (remoteShape && !isFullUnitShape(remoteShape)) {
      geometryCache.set(key, remoteShape);
    } else {
      geometryCache.set(key, createGeometryForBlock(id, properties));
    }
  }
  return geometryCache.get(key);
}

function isFullUnitShape(shapeData) {
  return shapeData?.fullUnit === true;
}

async function remoteModelGeometry(blockId) {
  if (!(location.protocol === "http:" || location.protocol === "https:")) {
    return null;
  }

  if (remoteModelCache.has(blockId)) {
    return remoteModelCache.get(blockId);
  }

  const promise = loadModelGeometryFromUrl(`./api/assets/blocks/${encodeURIComponent(blockId)}/model`)
    .catch(() => null);

  remoteModelCache.set(blockId, promise);
  return promise;
}

async function loadModelGeometryFromUrl(url) {
  return fetch(url)
    .then(async (response) => {
      if (!response.ok) return null;
      const payload = await response.json();
      const model = payload.model;
      return shapeFromMinecraftModel(model);
    })
    .catch(() => null);
}

function shapeFromMinecraftModel(model) {
  if (!model?.elements?.length) return null;
  return shape(model.elements.map((element) => {
    const from = element.from || [0, 0, 0];
    const to = element.to || [16, 16, 16];
    const size = [
      Math.max(0.02, (to[0] - from[0]) / 16),
      Math.max(0.02, (to[1] - from[1]) / 16),
      Math.max(0.02, (to[2] - from[2]) / 16)
    ];
    const offset = [
      (from[0] + to[0]) / 32 - 0.5,
      (from[1] + to[1]) / 32 - 0.5,
      (from[2] + to[2]) / 32 - 0.5
    ];
    return { size, offset };
  }));
}

function createGeometryForBlock(id, properties) {
  const descriptor = blockShape(id, properties);
  if (descriptor.type === "cross") {
    return {
      geometry: crossGeometry(descriptor.width, descriptor.height),
      offset: new THREE.Vector3(...descriptor.offset),
      fullUnit: false
    };
  }
  const boxes = descriptor.type === "boxes"
    ? descriptor.boxes
    : [{ size: descriptor.size, offset: descriptor.offset }];
  return shape(boxes);
}

function faceCulledMesh(label, blocks, material, solidOccupancy, faceMaterials) {
  const geometry = faceCulledGeometry(blocks, solidOccupancy, faceMaterials);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.blocks = blocks;
  mesh.userData.label = label;
  return mesh;
}

function faceCulledGeometry(blocks, solidOccupancy, faceMaterials) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const groups = [];
  let vertexOffset = 0;
  let indexOffset = 0;

  for (const block of blocks) {
    for (const face of CUBE_FACES) {
      const neighbor = positionKey(
        block.pos.x + face.delta[0],
        block.pos.y + face.delta[1],
        block.pos.z + face.delta[2]
      );

      if (solidOccupancy.has(neighbor)) {
        continue;
      }

      for (const corner of face.corners) {
        positions.push(block.pos.x + corner[0], block.pos.y + corner[1], block.pos.z + corner[2]);
        normals.push(...face.normal);
      }
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(vertexOffset, vertexOffset + 2, vertexOffset + 1, vertexOffset, vertexOffset + 3, vertexOffset + 2);
      if (faceMaterials) {
        groups.push({ start: indexOffset, count: 6, materialIndex: face.materialIndex });
      }
      vertexOffset += 4;
      indexOffset += 6;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  for (const group of groups) {
    geometry.addGroup(group.start, group.count, group.materialIndex);
  }
  geometry.computeBoundingSphere();
  return geometry;
}

const CUBE_FACES = [
  {
    delta: [1, 0, 0],
    normal: [1, 0, 0],
    materialIndex: 0,
    corners: [[0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5]]
  },
  {
    delta: [-1, 0, 0],
    normal: [-1, 0, 0],
    materialIndex: 1,
    corners: [[-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5]]
  },
  {
    delta: [0, 1, 0],
    normal: [0, 1, 0],
    materialIndex: 2,
    corners: [[-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]
  },
  {
    delta: [0, -1, 0],
    normal: [0, -1, 0],
    materialIndex: 3,
    corners: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5]]
  },
  {
    delta: [0, 0, 1],
    normal: [0, 0, 1],
    materialIndex: 4,
    corners: [[0.5, -0.5, 0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5]]
  },
  {
    delta: [0, 0, -1],
    normal: [0, 0, -1],
    materialIndex: 5,
    corners: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]]
  }
];

function shape(boxes) {
  return {
    geometry: shapeGeometry(boxes),
    offset: new THREE.Vector3(0, 0, 0),
    fullUnit: boxes.length === 1 &&
      boxes[0].size.every((part) => part >= 0.98) &&
      boxes[0].offset.every((part) => Math.abs(part) < 0.01)
  };
}

function shapeGeometry(boxes) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let vertexOffset = 0;

  for (const box of boxes) {
    const geometry = new THREE.BoxGeometry(...box.size);
    geometry.translate(...box.offset);
    const position = geometry.getAttribute("position").array;
    const normal = geometry.getAttribute("normal").array;
    const uv = geometry.getAttribute("uv").array;
    const index = geometry.index.array;

    positions.push(...position);
    normals.push(...normal);
    uvs.push(...uv);
    for (const item of index) {
      indices.push(item + vertexOffset);
    }
    vertexOffset += position.length / 3;
    geometry.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  merged.setIndex(indices);
  merged.computeBoundingSphere();
  return merged;
}

function crossGeometry(width, height) {
  const half = width / 2;
  const y0 = -0.5;
  const y1 = -0.5 + height;
  const positions = [
    -half, y0, -half, half, y0, half, half, y1, half, -half, y1, -half,
    half, y0, -half, -half, y0, half, -half, y1, half, half, y1, -half
  ];
  const normals = [
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1
  ];
  const uvs = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
  const indices = [0, 2, 1, 0, 3, 2, 1, 2, 0, 2, 3, 0, 4, 6, 5, 4, 7, 6, 5, 6, 4, 6, 7, 4];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function blockIconUrl(label) {
  const blockId = encodeURIComponent(blockIdFromLabel(label));
  if (location.protocol === "http:" || location.protocol === "https:") {
    return `./api/assets/blocks/${blockId}/preview`;
  }
  return "";
}

function updateTextureStatus(message) {
  elements.textureStatus.textContent = message;
}

function setBusy(message) {
  elements.viewerTitle.textContent = message;
  elements.viewerSubtitle.textContent = "Parsing NBT and preparing preview data.";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function updatePointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function updateHover() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(state.meshGroups, false);
  if (!hits.length) {
    elements.hoverReadout.textContent = "Hover a block";
    return;
  }

  const hit = hits[0];
  const block = hit.instanceId === undefined ? null : hit.object.userData.blocks[hit.instanceId];
  elements.hoverReadout.textContent = block
    ? `${block.label} @ ${block.pos.x}, ${block.pos.y}, ${block.pos.z}`
    : hit.object.userData.label;
}

function requestSceneRender() {
  state.needsRender = true;
}

function updateSceneOpacity() {
  for (const mesh of state.meshGroups) {
    const opacity = opacityForBlock(mesh.userData.label || "");
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      material.opacity = opacity;
      material.transparent = opacity < 1;
      material.needsUpdate = true;
    }
  }
  requestSceneRender();
}

elements.fileInput.addEventListener("change", async () => {
  const file = elements.fileInput.files?.[0];
  if (!file) {
    return;
  }

  try {
    await loadFile(file);
  } catch (error) {
    elements.viewerTitle.textContent = "Could not load schematic";
    elements.viewerSubtitle.textContent = error.message;
  }
});

document.addEventListener("schematic-library:add-current", async () => {
  setLibraryStatus("Adding current schematic…", "loading");
  try {
    const item = await addCurrentSchematicToLibrary();
    setLibraryStatus(`Added ${item.title}.`, "success");
    document.dispatchEvent(new CustomEvent("schematic-library:refresh"));
  } catch (error) {
    setLibraryStatus(error instanceof Error ? error.message : String(error), "error");
  }
});

document.addEventListener("schematic-library:open", async (event) => {
  const file = event.detail?.file;
  if (!file) return;
  try {
    await loadFile(file);
  } catch (error) {
    elements.viewerTitle.textContent = "Could not load schematic";
    elements.viewerSubtitle.textContent = error instanceof Error ? error.message : String(error);
  }
});

document.addEventListener("schematic-library:capabilities", (event) => {
  const canWrite = Boolean(event.detail?.canWrite);
  elements.assetAdminPanel.toggleAttribute("hidden", !canWrite);
  elements.assetPackInput.disabled = !canWrite;
  elements.assetPackLoader.toggleAttribute("hidden", !canWrite);
});

elements.litematicInput.addEventListener("change", () => {
  const file = elements.litematicInput.files?.[0];
  elements.convertLitematic.disabled = !file;
  elements.loadConverted.disabled = true;
  elements.downloadConverted.hidden = true;
  elements.converterStatus.textContent = file ? `Ready to convert ${file.name}.` : "Choose a .litematic or .schem file.";
});

elements.converterSplitKb.addEventListener("change", normalizedSplitKb);

elements.convertLitematic.addEventListener("click", async () => {
  const file = elements.litematicInput.files?.[0];
  if (!file) {
    return;
  }

  elements.convertLitematic.disabled = true;
  try {
    await convertLitematicFile(file);
  } catch (error) {
    elements.converterStatus.textContent = error.message;
  } finally {
    elements.convertLitematic.disabled = false;
  }
});

elements.showConverterLog.addEventListener("click", async () => {
  try {
    showOperationLog("converter");
    elements.converterStatus.textContent = "Converter log printed to the browser console.";
  } catch (error) {
    elements.converterStatus.textContent = error.message;
  }
});

elements.loadConverted.addEventListener("click", async () => {
  if (!state.convertedFile) {
    return;
  }

  try {
    await loadFile(state.convertedFile);
  } catch (error) {
    elements.converterStatus.textContent = `Converted file could not be loaded: ${error.message}`;
  }
});

elements.assetPackInput.addEventListener("change", async () => {
  const files = [...(elements.assetPackInput.files || [])];
  if (!files.length) {
    return;
  }

  try {
    for (const file of files) {
      await loadAssetPack(file);
    }
  } catch (error) {
    updateAssetStats({ name: error.message, packs: [], textures: 0, models: 0, blockstates: 0, namespaces: [] });
  }
});

for (const eventName of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("dragging");
  });
}

elements.dropZone.addEventListener("drop", async (event) => {
  const file = event.dataTransfer.files?.[0];
  if (!file) {
    return;
  }

  try {
    await loadFile(file);
  } catch (error) {
    elements.viewerTitle.textContent = "Could not load schematic";
    elements.viewerSubtitle.textContent = error.message;
  }
});

elements.layerSlider.addEventListener("input", () => {
  state.activeLayer = Number(elements.layerSlider.value);
  elements.layerLabel.textContent = String(state.activeLayer);
  renderSchematic();
});

elements.showAllLayers.addEventListener("click", () => {
  state.activeLayer = null;
  elements.layerLabel.textContent = "All";
  renderSchematic();
});

elements.hologramToggle.addEventListener("change", renderSchematic);
elements.opacitySlider.addEventListener("input", () => {
  elements.opacityLabel.textContent = `${elements.opacitySlider.value}%`;
  updateSceneOpacity();
});
elements.glassOpacitySlider.addEventListener("input", () => {
  elements.glassOpacityLabel.textContent = `${elements.glassOpacitySlider.value}%`;
  updateSceneOpacity();
});
elements.gridToggle.addEventListener("change", renderSchematic);
elements.textureToggle.addEventListener("change", () => {
  updatePaletteList();
  renderSchematic();
});
elements.resetCamera.addEventListener("click", resetCameraToSchematic);

for (const element of [elements.facingPreset, elements.schematicYaw, elements.flipXToggle, elements.flipZToggle]) {
  element.addEventListener("change", () => {
    updateOrientationFromControls();
    geometryCache.clear();
    renderSchematic();
  });
}

elements.copyOrientation.addEventListener("click", async () => {
  updateOrientationFromControls();
  const profile = orientationProfile(state.orientation);
  const text = JSON.stringify(profile, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    elements.orientationStatus.textContent = "Orientation JSON copied to clipboard.";
  } catch {
    elements.orientationStatus.textContent = text;
  }
});

elements.replaceBlock.addEventListener("click", () => {
  const source = elements.sourceBlock.value;
  const replacement = elements.replacementBlock.value.trim();
  if (!source || !replacement) {
    return;
  }
  state.replacements.set(source, replacement);
  elements.writeReplacements.disabled = false;
  elements.replacementStatus.textContent = `Previewing ${state.replacements.size.toLocaleString()} replacement mappings.`;
  updatePaletteList();
  renderSchematic();
});

elements.exportItemList.addEventListener("click", downloadItemList);
elements.printItemList.addEventListener("click", async () => {
  try {
    printItemListToConsole();
  } catch (error) {
    elements.itemExportStatus.textContent = error.message;
  }
});

elements.woodSource.addEventListener("change", renderWoodMatchList);
elements.woodTarget.addEventListener("change", renderWoodMatchList);
elements.previewWoodSwap.addEventListener("click", previewWoodSwap);
elements.showReplacementLog.addEventListener("click", async () => {
  try {
    showOperationLog("replacements");
    elements.replacementStatus.textContent = "Replacement log printed to the browser console.";
  } catch (error) {
    elements.replacementStatus.textContent = error.message;
  }
});
elements.downloadModified.addEventListener("click", (event) => {
  if (!state.modifiedUrl || elements.downloadModified.href !== state.modifiedUrl) {
    event.preventDefault();
    elements.replacementStatus.textContent = "Write changes first; no modified schematic is ready to download.";
  }
});
elements.writeReplacements.addEventListener("click", async () => {
  elements.writeReplacements.disabled = true;
  try {
    await writeReplacementFile();
  } catch (error) {
    elements.replacementStatus.textContent = error.message;
  } finally {
    elements.writeReplacements.disabled = state.replacements.size === 0;
  }
});

renderer.domElement.addEventListener("pointermove", (event) => {
  updatePointer(event);
  updateHover();
});

window.addEventListener("resize", resize);
if ("ResizeObserver" in window) {
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(elements.viewer);
}
applyDefaultOrientationControls();
loadSplitKbPreference();
resize();
animate();

function applyDefaultOrientationControls() {
  elements.facingPreset.value = DEFAULT_ORIENTATION.facingPreset;
  elements.schematicYaw.value = String(DEFAULT_ORIENTATION.schematicYaw);
  elements.flipXToggle.checked = DEFAULT_ORIENTATION.flipX;
  elements.flipZToggle.checked = DEFAULT_ORIENTATION.flipZ;
  updateOrientationFromControls();
}

function updateOrientationFromControls() {
  state.orientation = {
    facingPreset: elements.facingPreset.value,
    schematicYaw: Number(elements.schematicYaw.value),
    flipX: elements.flipXToggle.checked,
    flipZ: elements.flipZToggle.checked
  };
  elements.orientationStatus.textContent = `${state.orientation.facingPreset}, yaw ${state.orientation.schematicYaw}, flipX ${state.orientation.flipX}, flipZ ${state.orientation.flipZ}`;
}
