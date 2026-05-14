import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = process.cwd();
const packageDir = path.join(rootDir, "native", "macos-vision-ocr");
const hostName = "com.translect.ocr";

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return "";
  }
  return process.argv[index + 1] || "";
}

const extensionId = readArg("--extension-id");
const browser = readArg("--browser") || "chrome";

if (!extensionId) {
  console.error("Usage: npm run install:macos-ocr-host -- --extension-id <chrome-extension-id> [--browser chrome|chromium|chrome-for-testing]");
  process.exit(1);
}

const manifestDirs = {
  chrome: path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts"),
  "chrome-for-testing": path.join(os.homedir(), "Library", "Application Support", "Google", "ChromeForTesting", "NativeMessagingHosts"),
  chromium: path.join(os.homedir(), "Library", "Application Support", "Chromium", "NativeMessagingHosts")
};

const manifestDir = manifestDirs[browser];
if (!manifestDir) {
  console.error("Unsupported browser. Use chrome, chromium, or chrome-for-testing.");
  process.exit(1);
}

await execFileAsync("swift", ["build", "-c", "release"], { cwd: packageDir });

const executablePath = path.join(
  packageDir,
  ".build",
  "release",
  "translect-macos-vision-ocr"
);
const manifestPath = path.join(manifestDir, `${hostName}.json`);
const manifest = {
  name: hostName,
  description: "Translect macOS Vision OCR native host",
  path: executablePath,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extensionId}/`]
};

await mkdir(manifestDir, { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Built native host: ${executablePath}`);
console.log(`Wrote manifest: ${manifestPath}`);
