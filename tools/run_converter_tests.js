import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const converter = join(root, "converter");
const candidates = [
  process.env.PYTHON ? { command: process.env.PYTHON, args: [] } : null,
  { command: join(root, ".venv", "Scripts", "python.exe"), args: [] },
  { command: join(root, ".venv", "bin", "python"), args: [] },
  { command: join(converter, ".venv", "Scripts", "python.exe"), args: [] },
  { command: join(converter, ".venv", "bin", "python"), args: [] },
  { command: "python3", args: [] },
  { command: "python", args: [] },
  { command: "py", args: ["-3"] }
].filter(Boolean);

function canRunPytest(candidate) {
  if (candidate.command.includes(".venv") && !existsSync(candidate.command)) {
    return false;
  }
  return spawnSync(candidate.command, [...candidate.args, "-c", "import pytest"], {
    cwd: converter,
    stdio: "ignore",
    windowsHide: true
  }).status === 0;
}

const python = candidates.find(canRunPytest);
if (!python) {
  console.error("No Python environment with pytest was found. Run npm run setup first.");
  process.exit(1);
}

const result = spawnSync(python.command, [...python.args, "-m", "pytest"], {
  cwd: converter,
  stdio: "inherit",
  windowsHide: true
});

process.exit(result.status ?? 1);
