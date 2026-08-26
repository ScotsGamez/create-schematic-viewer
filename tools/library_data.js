import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createLibraryBackup, restoreLibraryBackup } from "../src/library/backup.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataDir = resolve(process.env.DATA_DIR || join(root, ".data"));
const [command, pathArgument] = process.argv.slice(2);

if (!pathArgument || !["backup", "restore"].includes(command)) {
  console.error("Usage: node tools/library_data.js <backup|restore> <directory>");
  process.exit(1);
}

try {
  if (command === "backup") {
    const result = await createLibraryBackup({ sourceDir: dataDir, destinationDir: pathArgument });
    console.log(JSON.stringify({ operation: "backup", createdAt: result.createdAt }));
  } else {
    const result = await restoreLibraryBackup({ backupDir: pathArgument, targetDir: dataDir });
    console.log(JSON.stringify({ operation: "restore", backupCreatedAt: result.createdAt }));
  }
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(1);
}
