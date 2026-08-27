import http from "node:http";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { assetSummary, getTexture, loadAssetPack, resolveBlockModel, resolveBlockTextures } from "./src/asset-pack.js";
import { createLibraryApi } from "./src/server/library-api.js";
import { parseUploadedSchematic, validateSchematicZip } from "./src/server/schematic-upload.js";
import { createWriteAuthorizer } from "./src/server/write-authorization.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const converterDir = join(root, "converter");
const converterScript = join(converterDir, "litematic_to_nbt.py");
const replacementScript = join(root, "tools", "apply_replacements.py");
const conversionTmpDir = join(root, ".tmp", "conversions");
const defaultDataDir = join(root, ".data");
const port = Number(process.env.PORT || 4173);
const host = String(process.env.HOST || "127.0.0.1");
const maxUploadBytes = 80 * 1024 * 1024;
const maxAssetPackBytes = 250 * 1024 * 1024;
const defaultSplitMaxKb = Number(process.env.SPLIT_MAX_KB || 512);
const pythonCandidates = [
  join(root, ".venv", "Scripts", "python.exe"),
  join(root, ".venv", "bin", "python"),
  join(converterDir, ".venv", "Scripts", "python.exe"),
  join(converterDir, ".venv", "bin", "python"),
  process.env.PYTHON,
  "python3",
  "python",
  "py"
].filter(Boolean);
let workingPython = null;

const vendorFiles = new Map([
  ["/vendor/three/three.min.js", join(root, "node_modules", "three", "build", "three.min.js")],
  ["/vendor/three/OrbitControls.js", join(root, "node_modules", "three", "examples", "js", "controls", "OrbitControls.js")]
]);

const readinessFiles = [
  join(publicDir, "index.html"),
  join(publicDir, "app.js"),
  join(publicDir, "style.css"),
  join(publicDir, "styles.css"),
  join(publicDir, "js", "api-client.js"),
  join(publicDir, "js", "block-shapes.js"),
  join(publicDir, "js", "library-client.js"),
  join(publicDir, "js", "orientation.js"),
  join(publicDir, "js", "replacements.js"),
  join(publicDir, "js", "schematic-data.js"),
  ...vendorFiles.values()
];

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

function applySecurityHeaders(response) {
  response.setHeader("content-security-policy", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "worker-src 'none'"
  ].join("; "));
  response.setHeader("cross-origin-resource-policy", "same-origin");
  response.setHeader("permissions-policy", "camera=(), geolocation=(), microphone=()");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "SAMEORIGIN");
}

export function formatLogLine(level, event, fields = {}) {
  return JSON.stringify({
    ...fields,
    timestamp: new Date().toISOString(),
    level: String(level),
    event: String(event)
  });
}

function writeLog(level, event, fields = {}) {
  const line = formatLogLine(level, event, fields);
  if (level === "error") {
    console.error(line);
    return;
  }
  console.log(line);
}

async function isReady(storageReadiness) {
  try {
    await Promise.all([
      storageReadiness(),
      ...readinessFiles.map((filePath) => stat(filePath))
    ]);
    return true;
  } catch {
    return false;
  }
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

async function serveVendor(pathname, response) {
  const filePath = vendorFiles.get(pathname);
  if (!filePath) {
    return false;
  }

  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
      "content-length": file.length
    });
    response.end(file);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
  return true;
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

/**
 * @param {{
 *   dataDir?: string,
 *   libraryWriteEnabled?: boolean,
 *   libraryWriteMode?: string,
 *   libraryAdminTokenFile?: string
 * }} [options]
 */
export function createAppServer({
  dataDir = process.env.DATA_DIR || defaultDataDir,
  libraryWriteEnabled = process.env.LIBRARY_WRITE_ENABLED === "true",
  libraryWriteMode = process.env.LIBRARY_WRITE_MODE,
  libraryAdminTokenFile = process.env.LIBRARY_ADMIN_TOKEN_FILE
} = {}) {
  const writeAuthorization = createWriteAuthorizer({
    mode: libraryWriteMode,
    tokenFile: libraryAdminTokenFile,
    legacyWriteEnabled: libraryWriteEnabled
  });
  const libraryApi = createLibraryApi({
    dataDir,
    canWrite: writeAuthorization.canWrite,
    maxUploadBytes: maxAssetPackBytes,
    parseSchematic: parseUploadedSchematic,
    loadAssetPack
  });
  libraryApi.initialization.catch((error) => writeLog("error", "library_initialization_failed", {
    message: String(error?.message || error).slice(0, 1000)
  }));

  return http.createServer(async (request, response) => {
    applySecurityHeaders(response);
    try {
      const url = route(request);
      const localTextureMatch = url.pathname.match(/^\/api\/assets\/textures\/(.+)$/);
      const localBlockTextureMatch = url.pathname.match(/^\/api\/assets\/blocks\/(.+)\/textures$/);
      const localBlockModelMatch = url.pathname.match(/^\/api\/assets\/blocks\/(.+)\/model$/);
      const localBlockPreviewMatch = url.pathname.match(/^\/api\/assets\/blocks\/(.+)\/preview$/);

      if (request.method === "GET" && url.pathname === "/healthz") {
        sendJson(response, 200, { status: "ok" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/readyz") {
        const ready = await isReady(libraryApi.checkReadiness);
        sendJson(response, ready ? 200 : 503, { status: ready ? "ready" : "unavailable" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/capabilities") {
        response.setHeader("cache-control", "no-store");
        sendJson(response, 200, {
          application: "create-schematic-viewer",
          contractVersion: 1,
          capabilities: {
            libraryRead: true,
            libraryWrite: writeAuthorization.canWrite(request),
            conversion: true
          }
        });
        return;
      }

      if (request.method === "GET" && await serveVendor(url.pathname, response)) {
        return;
      }

      if (await libraryApi.handle(request, response, url)) {
        return;
      }

      if (url.pathname.startsWith("/api/assets")) {
        await libraryApi.initialization;
      }

      if (request.method === "GET" && url.pathname === "/api/assets") {
        sendJson(response, 200, assetSummary());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/assets/upload") {
        await libraryApi.importAsset(request, response);
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

      response.writeHead(405, { "allow": "GET, POST, DELETE" });
      response.end("Method not allowed");
    } catch (error) {
      const message = String(error?.message || "Unable to process request.").slice(0, 1000);
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
      writeLog("error", "request_failed", {
        method: request.method,
        status,
        message
      });
      sendJson(response, status, {
        error: message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createAppServer();
  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    writeLog("info", "shutdown_started", { signal: String(signal) });
    const forceCloseTimer = setTimeout(() => {
      writeLog("error", "shutdown_timeout");
      server.closeAllConnections?.();
      process.exitCode = 1;
    }, 10000);
    forceCloseTimer.unref();
    server.close((error) => {
      clearTimeout(forceCloseTimer);
      if (error) {
        writeLog("error", "shutdown_failed", {
          message: String(error.message).slice(0, 1000)
        });
        process.exitCode = 1;
      }
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  server.once("error", (error) => {
    writeLog("error", "server_error", {
      code: String(error.code || "UNKNOWN"),
      message: String(error.message).slice(0, 1000)
    });
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    writeLog("info", "server_started", { host, port });
  });
}
