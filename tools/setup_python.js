import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const venvPython = process.platform === "win32"
  ? join(root, ".venv", "Scripts", "python.exe")
  : join(root, ".venv", "bin", "python");
const converter = join(root, "converter");
const requirements = join(root, "converter", "requirements.txt");

const candidates = [
  process.env.PYTHON ? { command: process.env.PYTHON, args: [] } : null,
  { command: "python", args: [] },
  { command: "python3", args: [] },
  { command: "py", args: ["-3"] }
].filter(Boolean);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    ...options
  });
  return result;
}

function canUse(candidate) {
  const result = spawnSync(candidate.command, [...candidate.args, "-c", "import sys; print(sys.version)"], {
    cwd: root,
    stdio: "ignore",
    windowsHide: true
  });
  return result.status === 0;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const uv = process.env.UV || "uv";
const uvAvailable = spawnSync(uv, ["--version"], {
  cwd: root,
  stdio: "ignore",
  windowsHide: true
}).status === 0;

if (uvAvailable) {
  const sync = run(uv, ["sync", "--project", converter, "--locked"], {
    env: {
      ...process.env,
      UV_PROJECT_ENVIRONMENT: join(root, ".venv")
    }
  });
  if (sync.status !== 0) {
    fail("Could not synchronize the locked converter Python environment with uv.");
  }
  process.exit(0);
}

let python = null;
for (const candidate of candidates) {
  if (canUse(candidate)) {
    python = candidate;
    break;
  }
}

if (!python) {
  fail("Neither uv nor Python 3 was found. Install uv or Python 3, or set PYTHON to a Python executable, then run npm run setup again.");
}

if (!existsSync(venvPython)) {
  const venv = run(python.command, [...python.args, "-m", "venv", ".venv"]);
  if (venv.status !== 0) {
    fail("Could not create .venv for the converter.");
  }
}

const pipAvailable = spawnSync(venvPython, ["-m", "pip", "--version"], {
  cwd: root,
  stdio: "ignore",
  windowsHide: true
}).status === 0;
if (!pipAvailable) {
  const ensurePip = run(venvPython, ["-m", "ensurepip", "--upgrade"]);
  if (ensurePip.status !== 0) {
    fail("Could not install pip in the converter virtual environment.");
  }
}

const pip = run(venvPython, ["-m", "pip", "install", "--require-hashes", "-r", requirements]);
if (pip.status !== 0) {
  fail("Could not install the pinned converter Python requirements.");
}
