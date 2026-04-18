import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "package.json",
  "src/main/main.ts",
  "src/main/processor.ts",
  "src/preload/preload.ts",
  "src/renderer/App.tsx",
  "src/shared/types.ts",
  "src/shared/presets.ts"
];

const missing = requiredFiles.filter((file) => !existsSync(path.join(root, file)));
if (missing.length > 0) {
  throw new Error(`Missing required files: ${missing.join(", ")}`);
}

const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
for (const script of ["build", "typecheck", "start", "dev"]) {
  if (!packageJson.scripts?.[script]) {
    throw new Error(`package.json is missing the ${script} script`);
  }
}

const sourceText = requiredFiles
  .filter((file) => file.startsWith("src/"))
  .map((file) => readFileSync(path.join(root, file), "utf8"))
  .join("\n");

for (const oldName of ["Ryan Doty", "Nathaniel Redmond"]) {
  if (sourceText.includes(oldName)) {
    throw new Error(`New source should not reference old host name: ${oldName}`);
  }
}

for (const currentName of ["Maxx", "Lindsay", "qwen3-coder-emergency:latest"]) {
  if (!sourceText.includes(currentName)) {
    throw new Error(`Expected source to include ${currentName}`);
  }
}

console.log("Smoke checks passed.");
