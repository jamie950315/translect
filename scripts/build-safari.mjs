import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createSafariManifest } from "../src/shared/safari-manifest.js";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const distDir = path.join(rootDir, "dist");
const stagingResourcesDir = path.join(rootDir, "safari", ".extension-resources");
const resourcesDir = path.join(
  rootDir,
  "safari",
  "Translect",
  "Translect",
  "Translect Extension",
  "Resources"
);

await execFileAsync(process.execPath, ["scripts/build.mjs", "--safari"], {
  cwd: rootDir
});

const sourceManifest = JSON.parse(
  await readFile(path.join(distDir, "manifest.json"), "utf8")
);
const safariManifest = createSafariManifest(sourceManifest);

async function writeSafariResources(destinationDir) {
  await rm(destinationDir, { force: true, recursive: true });
  await mkdir(path.dirname(destinationDir), { recursive: true });
  await cp(distDir, destinationDir, { recursive: true });
  await writeFile(
    path.join(destinationDir, "manifest.json"),
    `${JSON.stringify(safariManifest, null, 2)}\n`
  );
}

await writeSafariResources(stagingResourcesDir);
await writeSafariResources(resourcesDir);

console.log(`Built Safari extension resources: ${resourcesDir}`);
