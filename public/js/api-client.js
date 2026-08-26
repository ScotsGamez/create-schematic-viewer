function endpoint(baseUrl, path) {
  return `${String(baseUrl).replace(/\/$/, "")}/${String(path).replace(/^\//, "")}`;
}

async function errorMessage(response, fallback) {
  const text = await response.text();
  if (!text) return fallback;

  try {
    return JSON.parse(text).error || fallback;
  } catch {
    return text;
  }
}

export function decodeHeaderLog(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function createApiClient({ baseUrl = "./api", fetchImpl = fetch } = {}) {
  const request = (path, options) => fetchImpl(endpoint(baseUrl, path), options);

  return {
    async loadAssetPack({ fileName, bytes }) {
      const response = await request("assets/upload", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-file-name": fileName
        },
        body: bytes
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response, "Unable to load asset pack."));
      }
      return response.json();
    },

    async convert({ fileName, bytes, splitMode, splitMaxKb }) {
      const response = await request("convert/litematic", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-file-name": fileName,
          "x-split-mode": splitMode,
          "x-split-max-kb": String(splitMaxKb)
        },
        body: bytes
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response, "Conversion failed."));
      }

      return {
        blob: await response.blob(),
        outputKind: response.headers.get("x-converter-output") || "nbt",
        modeUsed: response.headers.get("x-split-mode-used") || splitMode,
        splitKbUsed: response.headers.get("x-split-max-kb-used") || String(splitMaxKb),
        log: decodeHeaderLog(response.headers.get("x-converter-log"))
      };
    },

    async parseSchematic(bytes) {
      const response = await request("schematic", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: bytes
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response, "Unable to parse schematic."));
      }
      return response.json();
    },

    async writeReplacements(payload) {
      const response = await request("schematic/replacements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response, "Unable to write replacement file."));
      }

      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        log: decodeHeaderLog(response.headers.get("x-replacement-log"))
      };
    },

    async printLog(kind, text) {
      const response = await request("logs/print", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, text })
      });
      if (!response.ok) {
        throw new Error(await errorMessage(response, "Could not print log to the server console."));
      }
    }
  };
}
