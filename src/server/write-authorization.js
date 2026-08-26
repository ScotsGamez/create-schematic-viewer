import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

const MODES = new Set(["disabled", "local", "trusted-proxy"]);
const TRUSTED_PROXY_HEADER = "x-lantern-schematic-admin";

/**
 * Build the request-scoped policy for persistent library changes.
 *
 * `trusted-proxy` is intended for a private sidecar. The public reverse proxy
 * must remove any client-supplied copy of the header and inject the secret only
 * after it has authenticated an administrator.
 *
 * @param {{
 *   mode?: string,
 *   tokenFile?: string,
 *   legacyWriteEnabled?: boolean
 * }} [options]
 */
export function createWriteAuthorizer({
  mode,
  tokenFile,
  legacyWriteEnabled = false
} = {}) {
  const selectedMode = mode || (legacyWriteEnabled ? "local" : "disabled");
  if (!MODES.has(selectedMode)) {
    throw new Error(`LIBRARY_WRITE_MODE must be one of: ${[...MODES].join(", ")}.`);
  }
  if (tokenFile && selectedMode !== "trusted-proxy") {
    throw new Error("LIBRARY_ADMIN_TOKEN_FILE is only valid when LIBRARY_WRITE_MODE=trusted-proxy.");
  }

  let expectedToken = null;
  if (selectedMode === "trusted-proxy") {
    if (!tokenFile) {
      throw new Error("LIBRARY_ADMIN_TOKEN_FILE is required in trusted-proxy mode.");
    }
    expectedToken = readFileSync(tokenFile, "utf8").trim();
    if (Buffer.byteLength(expectedToken) < 32) {
      throw new Error("The trusted-proxy admin token must contain at least 32 bytes.");
    }
  }

  function canWrite(request) {
    if (selectedMode === "disabled") return false;
    if (selectedMode === "local") return true;

    const supplied = request?.headers?.[TRUSTED_PROXY_HEADER];
    if (typeof supplied !== "string") return false;
    return safeEqual(supplied, expectedToken);
  }

  return Object.freeze({
    mode: selectedMode,
    canWrite
  });
}

function safeEqual(actual, expected) {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
