import { afterEach, expect, test } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectories = [];
const children = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
    }
  }
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function eventually(check) {
  const deadline = Date.now() + 5000;
  while (true) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

test("watch builds from its own project and refreshes static resources", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "translect-build-test-"));
  temporaryDirectories.push(temporary);
  const project = path.join(temporary, "project");
  const caller = path.join(temporary, "caller");
  await mkdir(path.join(project, "scripts"), { recursive: true });
  await mkdir(path.join(caller, "dist"), { recursive: true });
  await writeFile(path.join(caller, "dist", "keep.txt"), "unrelated");
  await cp(path.join(root, "src"), path.join(project, "src"), { recursive: true });
  await cp(path.join(root, "scripts", "build.mjs"), path.join(project, "scripts", "build.mjs"));
  await symlink(path.join(root, "node_modules"), path.join(project, "node_modules"), "dir");
  const child = spawn(process.execPath, [path.join(project, "scripts", "build.mjs"), "--watch"], { cwd: caller });
  children.push(child);
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  await eventually(() => expect(output).toContain("Watching for changes..."));
  expect(await readFile(path.join(caller, "dist", "keep.txt"), "utf8")).toBe("unrelated");

  const updates = {
    "popup/popup.css": "body { color: red; }",
    "popup/popup.html": "<!doctype html><title>Updated</title>",
    "icons/review.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
    "manifest.json": JSON.stringify({ manifest_version: 3, name: "Updated", version: "1.0" })
  };
  for (const [relative, value] of Object.entries(updates)) {
    await writeFile(path.join(project, "src", relative), value);
  }
  await eventually(async () => {
    for (const [relative, value] of Object.entries(updates)) {
      expect(await readFile(path.join(project, "dist", relative), "utf8")).toBe(value);
    }
  });
  await writeFile(path.join(project, "src", "manifest.json"), "invalid-json");
  await eventually(() => {
    expect(child.exitCode).toBe(1);
    expect(output).toContain("Failed to update extension resources:");
  });
}, 15000);

test("native host installer rejects malformed extension IDs before building", () => {
  const result = spawnSync(process.execPath, [
    path.join(root, "scripts", "install-macos-vision-host.mjs"), "--extension-id", "bad-id"
  ], { encoding: "utf8", timeout: 5000 });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Usage:");
  expect(result.stdout).not.toContain("Built native host:");
});
