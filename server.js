import http from "node:http";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { parseSchematic } from "./src/schematic.js";
import { assetSummary, getTexture, loadAssetPack, resolveBlockModel, resolveBlockTextures } from "./src/asset-pack.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const converterDir = join(root, "converter");
const converterScript = join(converterDir, "litematic_to_nbt.py");
const replacementScript = join(root, "tools", "apply_replacements.py");
const conversionTmpDir = join(root, ".tmp", "conversions");
const port = Number(process.env.PORT || 4173);
const maxUploadBytes = 80 * 1024 * 1024;
const maxAssetPackBytes = 250 * 1024 * 1024;
const defaultSplitMaxKb = Number(process.env.SPLIT_MAX_KB || 512);
const previewBlockLimit = 1000000;
const pythonCandidates = [
  join(root, ".venv", "Scripts", "python.exe"),
  join(converterDir, ".venv", "Scripts", "python.exe"),
  process.env.PYTHON,
  "python",
  "py"
].filter(Boolean);
let workingPython = null;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

function printLog(kind, text) {
  const label = String(kind || "app").replace(/[^\w.-]+/g, "-").slice(0, 48) || "app";
  const body = String(text || "").slice(0, 40000);
  console.log(`\n========== ${label} log ==========\n${body || "(empty)"}\n======== end ${label} log ========\n`);
}

function route(request) {
  return new URL(request.url, `http://${request.headers.host}`);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxUploadBytes) {
        request.destroy(new Error("Upload is larger than 80 MB."));
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function readLargeRequestBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        request.destroy(new Error(`Upload is larger than ${Math.round(limit / 1024 / 1024)} MB.`));
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function parseUploadedSchematic(body) {
  if (isZip(body)) {
    return parseSchematicZip(body);
  }
  return parseSchematic(body);
}

function isZip(buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

function parseSchematicZip(buffer) {
  const entries = extractZipEntries(buffer)
    .filter((entry) => entry.name.toLowerCase().endsWith(".nbt"))
    .sort((a, b) => partOrder(a.name) - partOrder(b.name) || a.name.localeCompare(b.name));

  if (!entries.length) {
    throw new Error("Zip does not contain any .nbt schematic parts.");
  }

  const schematics = entries.map((entry) => ({ name: entry.name, schematic: parseSchematic(entry.data) }));
  return combineSchematicParts(schematics);
}

function extractZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;

  while (offset < end) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Zip central directory is malformed.");
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const encoding = (flags & 0x0800) !== 0 ? "utf8" : "utf8";
    const name = buffer.toString(encoding, offset + 46, offset + 46 + fileNameLength).replace(/\\/g, "/");

    if (!name.endsWith("/")) {
      entries.push({ name, data: extractZipEntry(buffer, localHeaderOffset, compressedSize, method) });
    }
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function extractZipEntry(buffer, localHeaderOffset, compressedSize, method) {
  if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
    throw new Error("Zip local file header is malformed.");
  }
  const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataOffset = localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
  if (method === 0) {
    return Buffer.from(compressed);
  }
  if (method === 8) {
    return inflateRawSync(compressed);
  }
  throw new Error(`Zip entry uses unsupported compression method ${method}.`);
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("Zip end-of-central-directory record was not found.");
}

function partOrder(name) {
  const match = String(name).match(/_part_(\d+)_of_(\d+)\.nbt$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function combineSchematicParts(parts) {
  const allBlocks = [];
  const paletteLookup = new Map();
  const palette = [];
  const blockCounts = new Map();
  const warnings = [];
  let yOffset = 0;
  let totalBlocks = 0;
  let visibleBlocks = 0;
  let maxX = 0;
  let maxZ = 0;
  let dataVersion = parts[0]?.schematic.dataVersion || null;

  for (const part of parts) {
    const schematic = part.schematic;
    maxX = Math.max(maxX, Number(schematic.size?.x || 0));
    maxZ = Math.max(maxZ, Number(schematic.size?.z || 0));
    totalBlocks += schematic.totalBlocks;
    visibleBlocks += schematic.visibleBlocks;
    warnings.push(...(schematic.warnings || []).map((warning) => `${part.name}: ${warning}`));

    for (const block of schematic.blocks) {
      const label = block.label;
      if (!paletteLookup.has(label)) {
        paletteLookup.set(label, palette.length);
        palette.push({ index: palette.length, name: block.name, properties: block.properties || {}, label });
      }
      blockCounts.set(label, (blockCounts.get(label) || 0) + 1);
      if (allBlocks.length < previewBlockLimit) {
        allBlocks.push({
          ...block,
          index: allBlocks.length,
          state: paletteLookup.get(label),
          pos: { x: block.pos.x, y: block.pos.y + yOffset, z: block.pos.z }
        });
      }
    }
    yOffset += Number(schematic.size?.y || 0);
  }

  return {
    rootName: "combined_zip",
    dataVersion,
    size: { x: maxX, y: yOffset, z: maxZ },
    palette,
    blocks: allBlocks,
    truncated: totalBlocks > previewBlockLimit,
    totalBlocks,
    visibleBlocks,
    blockCounts: [...blockCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    entities: parts.reduce((sum, part) => sum + Number(part.schematic.entities || 0), 0),
    blockEntities: parts.reduce((sum, part) => sum + Number(part.schematic.blockEntities || 0), 0),
    warnings: [
      `Loaded ${parts.length} zipped schematic part(s) in part-number order.`,
      ...warnings
    ]
  };
}

async function serveStatic(request, response) {
  const requested = route(request).pathname;
  const cleanPath = normalize(decodeURIComponent(requested))
    .replace(/^[/\\]+/, "")
    .replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, cleanPath === "" ? "index.html" : cleanPath);

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      "content-type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
      "content-length": file.length
    });
    response.end(file);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

async function convertLitematic(request, response) {
  const body = await readLargeRequestBody(request, maxAssetPackBytes);
  const jobId = randomUUID();
  const jobDir = join(conversionTmpDir, jobId);
  const inputName = String(request.headers["x-file-name"] || "input.litematic");
  const splitMode = String(request.headers["x-split-mode"] || "single").toLowerCase();
  const splitMaxKb = normalizeSplitMaxKb(request.headers["x-split-max-kb"]);
  const inputExtension = extname(inputName).toLowerCase() === ".schem" ? ".schem" : ".litematic";
  const inputBaseName = safeBaseName(inputName.replace(/\.[^.]+$/, "") || "converted");
  const inputPath = join(jobDir, `${inputBaseName}${inputExtension}`);
  const outputPath = join(jobDir, "output.nbt");
  const splitOutputPath = join(jobDir, "output.zip");

  await mkdir(jobDir, { recursive: true });
  await writeFile(inputPath, body);

  try {
    const result = await runConverter(inputPath, outputPath, splitMode, splitMaxKb);
    const actualOutputPath = await pathExists(splitOutputPath) ? splitOutputPath : outputPath;
    const output = await readFile(actualOutputPath);
    const isZip = actualOutputPath === splitOutputPath;
    if (isZip) {
      validateSchematicZip(output);
    }
    response.writeHead(200, {
      "content-type": isZip ? "application/zip" : "application/octet-stream",
      "content-disposition": `attachment; filename="${isZip ? "converted_parts.zip" : "converted.nbt"}"`,
      "content-length": output.length,
      "x-converter-output": isZip ? "zip" : "nbt",
      "x-split-mode-used": splitMode,
      "x-split-max-kb-used": String(splitMode === "split" ? splitMaxKb : 0),
      "x-converter-log": encodeURIComponent(result.stdout.slice(-4000))
    });
    response.end(output);
  } finally {
    await rm(jobDir, { recursive: true, force: true });
  }
}

function validateSchematicZip(buffer) {
  const entries = extractZipEntries(buffer).filter((entry) => entry.name.toLowerCase().endsWith(".nbt"));
  if (!entries.length) {
    throw new Error("Converter produced a zip without any .nbt files.");
  }
  for (const entry of entries) {
    if (entry.data[0] !== 0x1f || entry.data[1] !== 0x8b) {
      throw new Error(`Zip entry ${entry.name} is not gzipped NBT.`);
    }
    parseSchematic(entry.data);
  }
}

function safeBaseName(name) {
  return String(name)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90) || "schematic";
}

async function applySchematicReplacements(request, response) {
  const body = await readLargeRequestBody(request, maxAssetPackBytes);
  const payload = JSON.parse(body.toString("utf8"));
  const sourceBytes = Buffer.from(String(payload.file || ""), "base64");
  const replacements = Array.isArray(payload.replacements) ? payload.replacements : [];

  if (!sourceBytes.length) {
    throw new Error("No schematic file was provided.");
  }
  if (!replacements.length) {
    throw new Error("No replacements were selected.");
  }

  const jobId = randomUUID();
  const jobDir = join(conversionTmpDir, jobId);
  const inputName = String(payload.fileName || "schematic.nbt");
  const inputExtension = [".nbt", ".schem", ".schematic"].includes(extname(inputName).toLowerCase())
    ? extname(inputName).toLowerCase()
    : ".nbt";
  const inputPath = join(jobDir, `input${inputExtension}`);
  const outputPath = join(jobDir, `output${inputExtension}`);

  await mkdir(jobDir, { recursive: true });
  await writeFile(inputPath, sourceBytes);

  try {
    const result = await runPythonScript(replacementScript, [inputPath, outputPath, JSON.stringify(replacements)], root);
    const output = await readFile(outputPath);
    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-disposition": "attachment; filename=\"modified.nbt\"",
      "content-length": output.length,
      "x-replacement-log": encodeURIComponent(result.stdout.slice(-4000))
    });
    response.end(output);
  } finally {
    await rm(jobDir, { recursive: true, force: true });
  }
}

async function runConverter(inputPath, outputPath, splitMode = "split", splitMaxKb = defaultSplitMaxKb) {
  const maxKb = splitMode === "split" ? splitMaxKb : 0;
  const args = [inputPath, outputPath, "--split-max-kb", String(maxKb)];
  const result = await runPythonScript(converterScript, args, converterDir);
  return {
    ...result,
    stdout: [
      `Converter mode: ${splitMode}`,
      `Split max KB: ${maxKb}`,
      `Converter args: ${[converterScript, ...args].join(" ")}`,
      result.stdout
    ].filter(Boolean).join("\n")
  };
}

function normalizeSplitMaxKb(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return defaultSplitMaxKb;
  }
  return Math.max(1, Math.floor(numeric));
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function runPythonScript(script, args, cwd) {
  let lastError = null;
  if (workingPython) {
    return spawnConverter(workingPython, [script, ...args], cwd);
  }

  for (const python of pythonCandidates) {
    try {
      await verifyConverterPython(python);
      workingPython = python;
      return await spawnConverter(python, [script, ...args], cwd);
    } catch (error) {
      lastError = error;
      if (error.code !== "ENOENT" && error.code !== "EPERM" && !error.message.includes("missing converter dependency")) {
        throw error;
      }
    }
  }

  throw new Error(lastError?.message || "No Python executable with nbtlib was found for the litematic converter.");
}

function verifyConverterPython(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["-c", "import nbtlib"], { windowsHide: true });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} is missing converter dependency nbtlib. ${stderr}`.trim()));
    });
  });
}

function spawnConverter(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || stdout || `Converter exited with code ${code}.`));
    });
  });
}

export function createAppServer() {
  return http.createServer(async (request, response) => {
    try {
      const url = route(request);
      const localTextureMatch = url.pathname.match(/^\/api\/assets\/textures\/(.+)$/);
      const localBlockTextureMatch = url.pathname.match(/^\/api\/assets\/blocks\/(.+)\/textures$/);
      const localBlockModelMatch = url.pathname.match(/^\/api\/assets\/blocks\/(.+)\/model$/);
      const localBlockPreviewMatch = url.pathname.match(/^\/api\/assets\/blocks\/(.+)\/preview$/);

      if (request.method === "GET" && url.pathname === "/api/assets") {
        sendJson(response, 200, assetSummary());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/assets/upload") {
        const body = await readLargeRequestBody(request, maxAssetPackBytes);
        const summary = loadAssetPack(body, request.headers["x-file-name"] || "asset-pack.jar");
        sendJson(response, 200, summary);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/convert/litematic") {
        await convertLitematic(request, response);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/schematic/replacements") {
        await applySchematicReplacements(request, response);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/logs/print") {
        const body = await readLargeRequestBody(request, 1024 * 1024);
        const payload = JSON.parse(body.toString("utf8"));
        printLog(payload.kind, payload.text);
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && localTextureMatch) {
        const textureId = decodeURIComponent(localTextureMatch[1]);
        const texture = getTexture(textureId);
        if (!texture) {
          sendJson(response, 404, { error: "Texture not found in loaded asset pack." });
          return;
        }
        response.writeHead(200, {
          "content-type": "image/png",
          "cache-control": "public, max-age=86400",
          "content-length": texture.length
        });
        response.end(texture);
        return;
      }

      if (request.method === "GET" && localBlockTextureMatch) {
        sendJson(response, 200, resolveBlockTextures(decodeURIComponent(localBlockTextureMatch[1])));
        return;
      }

      if (request.method === "GET" && localBlockPreviewMatch) {
        const resolved = resolveBlockTextures(decodeURIComponent(localBlockPreviewMatch[1]));
        const first = Object.values(resolved.textures || {})[0];
        const texture = first ? getTexture(first.id) : null;
        if (!texture) {
          response.writeHead(404);
          response.end("No local preview texture");
          return;
        }
        response.writeHead(200, {
          "content-type": "image/png",
          "cache-control": "public, max-age=86400",
          "content-length": texture.length
        });
        response.end(texture);
        return;
      }

      if (request.method === "GET" && localBlockModelMatch) {
        sendJson(response, 200, resolveBlockModel(decodeURIComponent(localBlockModelMatch[1])));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/schematic") {
        const body = await readLargeRequestBody(request, maxAssetPackBytes);
        const result = parseUploadedSchematic(body);
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "GET") {
        await serveStatic(request, response);
        return;
      }

      response.writeHead(405, { "allow": "GET, POST" });
      response.end("Method not allowed");
    } catch (error) {
      sendJson(response, 400, {
        error: error.message || "Unable to process request.",
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createAppServer().listen(port, () => {
    console.log(`Create schematic viewer running at http://localhost:${port}`);
  });
}
