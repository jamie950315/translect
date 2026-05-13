import { build, context } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const srcDir = path.join(rootDir, "src");
const distDir = path.join(rootDir, "dist");
const watchMode = process.argv.includes("--watch");

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
  target: ["chrome121"]
};

async function copyStaticFiles() {
  await mkdir(path.join(distDir, "popup"), { recursive: true });
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
  console.log("Watching for changes...");
} else {
  await buildOnce();
}
