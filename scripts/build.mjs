import { build, context } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(rootDir, "src");
const distDir = path.join(rootDir, "dist");
const watchMode = process.argv.includes("--watch");
const safariBuild = process.argv.includes("--safari");

const bundleConfig = {
  absWorkingDir: rootDir,
  bundle: true,
  entryPoints: {
    background: "src/background/service-worker.js",
    content: "src/content/content-script.js",
    "popup/popup": "src/popup/popup.js"
  },
  format: "esm",
  logLevel: "info",
  outdir: "dist",
  platform: "browser",
  sourcemap: false,
  target: safariBuild ? ["safari17"] : ["chrome121"]
};

async function copyStaticFiles() {
  await mkdir(path.join(distDir, "popup"), { recursive: true });
  await rm(path.join(distDir, "icons"), { recursive: true, force: true });
  await cp(path.join(srcDir, "icons"), path.join(distDir, "icons"), {
    recursive: true
  });
  await cp(path.join(srcDir, "popup", "popup.html"), path.join(distDir, "popup", "popup.html"));
  await cp(path.join(srcDir, "popup", "popup.css"), path.join(distDir, "popup", "popup.css"));

  const manifestPath = path.join(srcDir, "manifest.json");
  const manifestText = await readFile(manifestPath, "utf8");
  JSON.parse(manifestText);
  await writeFile(path.join(distDir, "manifest.json"), manifestText);
}

async function cleanDist() {
  await rm(distDir, { force: true, recursive: true });
  await mkdir(distDir, { recursive: true });
}

async function buildOnce() {
  await cleanDist();
  await build(bundleConfig);
  await copyStaticFiles();
}

if (watchMode) {
  await cleanDist();
  const ctx = await context(bundleConfig);
  await ctx.watch();
  await copyStaticFiles();
  let pendingCopy = Promise.resolve();
  let copyTimer;
  const watcher = watch(srcDir, { recursive: true }, (_event, filename) => {
    const relativePath = filename?.toString().split(path.sep).join("/");
    if (!relativePath || !(
      relativePath === "manifest.json" || relativePath.startsWith("icons/") ||
      relativePath === "icons" || relativePath === "popup/popup.html" ||
      relativePath === "popup/popup.css"
    )) return;

    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      pendingCopy = pendingCopy.then(copyStaticFiles).catch((error) => {
        console.error("Failed to update extension resources:", error);
        process.exit(1);
      });
    }, 50);
  });
  watcher.on("error", (error) => {
    console.error("Failed to watch extension resources:", error);
    process.exit(1);
  });
  console.log("Watching for changes...");
} else {
  await buildOnce();
}
