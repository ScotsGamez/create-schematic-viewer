import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const venvPython = process.platform === "win32"
  ? join(root, ".venv", "Scripts", "python.exe")
  : join(root, ".venv", "bin", "python");
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

let python = null;
for (const candidate of candidates) {
  if (canUse(candidate)) {
    python = candidate;
    break;
  }
}

if (!python) {
  fail("Python 3 was not found. Install Python 3, or set PYTHON to a Python executable, then run npm run setup again.");
}

if (!existsSync(venvPython)) {
  const venv = run(python.command, [...python.args, "-m", "venv", ".venv"]);
  if (venv.status !== 0) {
    fail("Could not create .venv for the converter.");
  }
}

const pip = run(venvPython, ["-m", "pip", "install", "-r", requirements]);
if (pip.status !== 0) {
  fail("Could not install converter Python requirements.");
}
