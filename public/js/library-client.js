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

async function jsonResult(response) {
  if (response.status === 204) return null;
  return response.json();
}

/**
 * Create the HTTP client for the persistent schematic library.
 *
 * @param {{baseUrl?: string, fetchImpl?: typeof fetch}} options
 */
export function createLibraryClient({ baseUrl = "./api/v1", fetchImpl = fetch } = {}) {
  const request = (path, options) => fetchImpl(endpoint(baseUrl, path), options);
  const itemPath = (id, suffix = "") => `library/schematics/${encodeURIComponent(String(id))}${suffix}`;

  const importAt = async (path, { bytes, fileName, title, metadata }) => {
    const headers = {
      "content-type": "application/octet-stream",
      "x-file-name": String(fileName),
      "x-title": String(title || fileName)
    };
    if (metadata !== undefined) {
      headers["x-library-metadata"] = encodeURIComponent(JSON.stringify(metadata));
    }

    const response = await request(path, {
      method: "POST",
      headers,
      body: bytes
    });
    if (!response.ok) {
      throw new Error(await errorMessage(response, "Unable to add the schematic to the library."));
    }
    return jsonResult(response);
  };

  return {
    async listSchematics({ query = "", includeTrashed = false } = {}) {
      const search = new URLSearchParams({
        query: String(query),
        includeTrashed: String(Boolean(includeTrashed))
      });
      const response = await request(`library/schematics?${search}`);
      if (!response.ok) {
        throw new Error(await errorMessage(response, "Unable to load the schematic library."));
      }
      const result = await response.json();
      return { ...result, items: Array.isArray(result.items) ? result.items : [] };
    },

    async importSchematic({ bytes, fileName, title, metadata }) {
      return importAt("library/schematics", { bytes, fileName, title, metadata });
    },

    async importSchematicVersion(id, { bytes, fileName, title, metadata }) {
      return importAt(itemPath(id, "/versions"), { bytes, fileName, title, metadata });
    },

    async getSchematic(id) {
      const response = await request(itemPath(id));
      if (!response.ok) {
        throw new Error(await errorMessage(response, "Unable to load schematic details."));
      }
      return response.json();
    },

    async getContent(id, version) {
      const suffix = version === undefined ? "/content" : `/content?version=${encodeURIComponent(String(version))}`;
      const response = await request(itemPath(id, suffix));
      if (!response.ok) {
        throw new Error(await errorMessage(response, "Unable to open the library schematic."));
      }
      return response.blob();
    },

    async trashSchematic(id) {
      const response = await request(itemPath(id), { method: "DELETE" });
      if (!response.ok) {
        throw new Error(await errorMessage(response, "Unable to move the schematic to trash."));
      }
      return jsonResult(response);
    },

    async restoreSchematic(id) {
      const response = await request(itemPath(id, "/restore"), { method: "POST" });
      if (!response.ok) {
        throw new Error(await errorMessage(response, "Unable to restore the schematic."));
      }
      return jsonResult(response);
    },

    previewUrl(id) {
      return endpoint(baseUrl, itemPath(id, "/preview.svg"));
    }
  };
}

function displayName(item) {
  return item.title || item.name || item.fileName || "Untitled schematic";
}

function fileName(item) {
  const fallback = `${displayName(item).replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "") || "schematic"}.nbt`;
  return item.fileName || item.originalFileName || fallback;
}

function isTrashed(item) {
  return Boolean(item.trashed || item.deletedAt || item.status === "trashed");
}

function compactNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString() : null;
}

function cardMeta(item) {
  const metadata = item.metadata || {};
  const blocks = compactNumber(item.totalBlocks ?? item.blockCount ?? metadata.totalBlocks ?? metadata.blockCount);
  const size = item.dimensions || metadata.dimensions || metadata.size;
  const dimensions = size && typeof size === "object"
    ? [size.x, size.y, size.z].filter((value) => value !== undefined).join(" × ")
    : size;
  return [
    blocks ? `${blocks} blocks` : null,
    dimensions ? `${dimensions}` : null,
    item.version ? `Version ${item.version}` : null,
    Array.isArray(item.warnings) && item.warnings.length
      ? `${item.warnings.length} compatibility warning${item.warnings.length === 1 ? "" : "s"}`
      : null
  ].filter(Boolean);
}

function button(documentRef, label, className, action) {
  const element = documentRef.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.addEventListener("click", action);
  return element;
}

function dispatchFileToViewer(documentRef, item, blob) {
  const selectedFile = new File([blob], fileName(item), {
    type: blob.type || "application/octet-stream"
  });

  documentRef.dispatchEvent(new CustomEvent("schematic-library:open", {
    detail: { file: selectedFile, item }
  }));
}

function downloadBlob(documentRef, item, blob) {
  const url = URL.createObjectURL(blob);
  const link = documentRef.createElement("a");
  link.href = url;
  link.download = fileName(item);
  link.hidden = true;
  documentRef.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Mount the library card UI in existing server-rendered markup.
 *
 * @param {HTMLElement} root
 * @param {{client?: ReturnType<typeof createLibraryClient>, documentRef?: Document}} options
 */
export function mountSchematicLibrary(root, {
  client = createLibraryClient(),
  documentRef = document
} = {}) {
  const search = /** @type {HTMLInputElement} */ (root.querySelector("#librarySearch"));
  const includeTrashed = /** @type {HTMLInputElement} */ (root.querySelector("#libraryIncludeTrashed"));
  const addCurrent = /** @type {HTMLButtonElement} */ (root.querySelector("#libraryAddCurrent"));
  const status = /** @type {HTMLElement} */ (root.querySelector("#libraryStatus"));
  const list = /** @type {HTMLElement} */ (root.querySelector("#libraryList"));
  let requestVersion = 0;
  let searchTimer = null;
  let canWrite = false;

  const setStatus = (message, kind = "idle") => {
    status.textContent = message;
    status.dataset.kind = kind;
  };

  const runCardAction = async (action, busyMessage, successMessage) => {
    setStatus(busyMessage, "loading");
    try {
      await action();
      if (successMessage) setStatus(successMessage, "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const makeCard = (item) => {
    const card = documentRef.createElement("article");
    card.className = "library-card";
    card.dataset.status = isTrashed(item) ? "trashed" : "active";
    card.setAttribute("role", "listitem");

    const preview = documentRef.createElement("img");
    preview.className = "library-preview";
    preview.src = client.previewUrl(item.id);
    preview.alt = "";
    preview.loading = "lazy";
    preview.addEventListener("error", () => preview.classList.add("library-preview-missing"));

    const body = documentRef.createElement("div");
    body.className = "library-card-body";
    const heading = documentRef.createElement("h3");
    heading.textContent = displayName(item);
    heading.title = displayName(item);

    const chip = documentRef.createElement("span");
    chip.className = "library-status-chip";
    chip.textContent = isTrashed(item) ? "Trash" : "Available";

    const titleRow = documentRef.createElement("div");
    titleRow.className = "library-card-title";
    titleRow.append(heading, chip);
    body.append(titleRow);

    const metadata = cardMeta(item);
    if (metadata.length) {
      const details = documentRef.createElement("p");
      details.className = "library-card-meta";
      details.textContent = metadata.join(" · ");
      body.append(details);
    }

    const actions = documentRef.createElement("div");
    actions.className = "library-card-actions";
    const history = documentRef.createElement("div");
    history.className = "library-card-history";
    history.hidden = true;

    const showHistory = async () => {
      if (history.dataset.loaded === "true") {
        history.hidden = !history.hidden;
        return;
      }
      const detail = await client.getSchematic(item.id);
      const versions = Array.isArray(detail.versions) ? [...detail.versions].reverse() : [];
      history.replaceChildren(...versions.map((version) => {
        const row = documentRef.createElement("div");
        row.className = "library-version-row";
        const label = documentRef.createElement("span");
        const date = version.importedAt ? new Date(version.importedAt).toLocaleDateString() : "";
        label.textContent = `Version ${version.version}${date ? ` · ${date}` : ""}`;
        const versionActions = documentRef.createElement("div");
        versionActions.append(
          button(documentRef, "Open", "library-action", () => runCardAction(async () => {
            const blob = await client.getContent(item.id, version.version);
            dispatchFileToViewer(documentRef, { ...item, version: version.version }, blob);
          }, `Opening version ${version.version}…`, "Opened in the viewer.")),
          button(documentRef, "Download", "library-action", () => runCardAction(async () => {
            const blob = await client.getContent(item.id, version.version);
            downloadBlob(documentRef, { ...item, version: version.version }, blob);
          }, `Preparing version ${version.version}…`, "Download ready."))
        );
        row.append(label, versionActions);
        return row;
      }));
      history.dataset.loaded = "true";
      history.hidden = false;
    };
    if (!isTrashed(item)) {
      actions.append(
        button(documentRef, "Open", "library-action library-action-primary", () => runCardAction(async () => {
          const blob = await client.getContent(item.id);
          dispatchFileToViewer(documentRef, item, blob);
        }, `Opening ${displayName(item)}…`, "Opened in the viewer.")),
        button(documentRef, "Download", "library-action", () => runCardAction(async () => {
          const blob = await client.getContent(item.id);
          downloadBlob(documentRef, item, blob);
        }, `Preparing ${displayName(item)}…`, "Download ready."))
      );
      if (canWrite) {
        actions.append(button(documentRef, "Trash", "library-action library-action-danger", () => runCardAction(async () => {
          await client.trashSchematic(item.id);
          await refresh();
        }, `Moving ${displayName(item)} to trash…`)));
      }
    } else if (canWrite) {
      actions.append(button(documentRef, "Restore", "library-action library-action-primary", () => runCardAction(async () => {
        await client.restoreSchematic(item.id);
        await refresh();
      }, `Restoring ${displayName(item)}…`)));
    }

    if (Number(item.version) > 1) {
      actions.append(button(documentRef, "History", "library-action", () => runCardAction(
        showHistory,
        `Loading ${displayName(item)} history…`
      )));
    }

    body.append(actions, history);
    card.append(preview, body);
    return card;
  };

  const render = (items) => {
    list.replaceChildren();
    if (!items.length) {
      const empty = documentRef.createElement("div");
      empty.className = "library-state";
      empty.textContent = search.value.trim()
        ? "No schematics match this search."
        : "No shared schematics yet. Add the current schematic to start the library.";
      list.append(empty);
      return;
    }
    list.append(...items.map(makeCard));
  };

  async function refresh() {
    const version = ++requestVersion;
    list.setAttribute("aria-busy", "true");
    setStatus("Loading shared schematics…", "loading");
    try {
      const result = await client.listSchematics({
        query: search.value.trim(),
        includeTrashed: includeTrashed.checked
      });
      if (version !== requestVersion) return;
      canWrite = Boolean(result.capabilities?.canWrite);
      root.dataset.canWrite = String(canWrite);
      addCurrent.hidden = !canWrite;
      documentRef.dispatchEvent(new CustomEvent("schematic-library:capabilities", {
        detail: { canWrite }
      }));
      render(result.items);
      const count = result.items.length;
      setStatus(`${count.toLocaleString()} schematic${count === 1 ? "" : "s"}`, "success");
    } catch (error) {
      if (version !== requestVersion) return;
      list.replaceChildren();
      const failure = documentRef.createElement("div");
      failure.className = "library-state library-state-error";
      failure.textContent = "The shared library could not be loaded.";
      list.append(failure);
      setStatus(error instanceof Error ? error.message : String(error), "error");
    } finally {
      if (version === requestVersion) list.removeAttribute("aria-busy");
    }
  }

  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refresh, 220);
  });
  includeTrashed.addEventListener("change", refresh);
  documentRef.addEventListener("schematic-library:refresh", refresh);
  addCurrent.addEventListener("click", () => {
    documentRef.dispatchEvent(new CustomEvent("schematic-library:add-current"));
  });

  refresh();
  return {
    refresh,
    destroy() {
      documentRef.removeEventListener("schematic-library:refresh", refresh);
      clearTimeout(searchTimer);
    }
  };
}

function autoMount() {
  const root = /** @type {HTMLElement | null} */ (document.querySelector("#schematicLibrary"));
  if (root) mountSchematicLibrary(root);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount, { once: true });
  } else {
    autoMount();
  }
}
