import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { describe, expect, test } from "vitest";

import * as browserCompat from "../src/shared/browser-compat.js";
import { getExtensionCommands } from "../src/shared/command-support.js";
import { createSafariManifest } from "../src/shared/safari-manifest.js";

describe("Safari Web Extension compatibility", () => {
  test("sends only the message payload through Safari native messaging", async () => {
    const calls = [];
    const message = { operation: "apple-intelligence-translate" };
    const safariApi = {
      runtime: {
        async sendNativeMessage(...args) {
          calls.push(args);
          return { ok: true };
        }
      }
    };
    const globalObject = { browser: safariApi };

    expect(browserCompat.sendNativeMessageToNativeApp).toBeTypeOf("function");
    await expect(
      browserCompat.sendNativeMessageToNativeApp(
        "com.translect.ocr",
        message,
        globalObject
      )
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual([[message]]);
  });

  test("keeps the native host name when Chromium sends a native message", async () => {
    const calls = [];
    const message = { operation: "apple-intelligence-translate" };
    const chromeApi = {
      runtime: {
        async sendNativeMessage(...args) {
          calls.push(args);
          return { ok: true };
        }
      }
    };
    const globalObject = { chrome: chromeApi };

    expect(browserCompat.sendNativeMessageToNativeApp).toBeTypeOf("function");
    await expect(
      browserCompat.sendNativeMessageToNativeApp(
        "com.translect.ocr",
        message,
        globalObject
      )
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual([["com.translect.ocr", message]]);
  });

  test("aliases Safari's browser API to chrome for shared extension modules", () => {
    const safariApi = { runtime: {} };
    const globalObject = { browser: safariApi };

    expect(browserCompat.installWebExtensionApiCompatibility(globalObject)).toBe(safariApi);
    expect(globalObject.chrome).toBe(safariApi);
  });

  test("keeps an existing Chrome API namespace intact", () => {
    const chromeApi = { runtime: { id: "chrome" } };
    const safariApi = { runtime: { id: "safari" } };
    const globalObject = { browser: safariApi, chrome: chromeApi };

    expect(browserCompat.installWebExtensionApiCompatibility(globalObject)).toBe(chromeApi);
    expect(globalObject.chrome).toBe(chromeApi);
  });

  test("falls back to no shortcuts when the browser does not expose commands", async () => {
    await expect(getExtensionCommands(undefined)).resolves.toEqual([]);
  });

  test("surfaces the original error when command discovery is rejected", async () => {
    await expect(
      getExtensionCommands({
        getAll: async () => {
          throw new Error("Commands are unavailable.");
        }
      })
    ).rejects.toThrow("Commands are unavailable.");
  });

  test("creates a Safari manifest without Chrome-only key or clipboard permission", () => {
    const sourceManifest = {
      background: {
        service_worker: "background.js",
        type: "module"
      },
      key: "chrome-extension-key",
      permissions: ["activeTab", "clipboardRead", "nativeMessaging", "storage"],
      version: "0.1.0"
    };

    const safariManifest = createSafariManifest(sourceManifest);

    expect(safariManifest).toEqual({
      background: {
        service_worker: "background.js"
      },
      permissions: ["activeTab", "nativeMessaging", "storage"],
      version: "0.1.0"
    });
    expect(sourceManifest).toHaveProperty("key", "chrome-extension-key");
    expect(sourceManifest.permissions).toContain("clipboardRead");
    expect(sourceManifest.background.type).toBe("module");
  });

  test("builds a Safari-ready extension resource bundle", async () => {
    const resourcesDir = path.join(
      process.cwd(),
      "safari",
      "Translect",
      "Translect",
      "Translect Extension",
      "Resources"
    );
    await rm(resourcesDir, { force: true, recursive: true });

    const result = spawnSync(process.execPath, ["scripts/build-safari.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);

    const manifest = JSON.parse(
      await readFile(path.join(resourcesDir, "manifest.json"), "utf8")
    );

    expect(manifest).not.toHaveProperty("key");
    expect(manifest.permissions).not.toContain("clipboardRead");
    expect(manifest.permissions).toContain("nativeMessaging");
    expect(manifest.icons).toEqual({
      "16": "icons/translect-16.png",
      "32": "icons/translect-32.png",
      "48": "icons/translect-48.png",
      "128": "icons/translect-128.png",
      "256": "icons/translect-256.png",
      "512": "icons/translect-512.png"
    });
    await expect(access(path.join(resourcesDir, "background.js"))).resolves.toBeUndefined();
    await expect(access(path.join(resourcesDir, "content.js"))).resolves.toBeUndefined();
    await expect(
      access(path.join(resourcesDir, "icons", "translect-128.png"))
    ).resolves.toBeUndefined();

    const stagingManifest = JSON.parse(
      await readFile(
        path.join(process.cwd(), "safari", ".extension-resources", "manifest.json"),
        "utf8"
      )
    );
    expect(stagingManifest).toEqual(manifest);
  });

  test("uses an app extension identifier derived from the containing Safari app", async () => {
    const project = await readFile(
      path.join(
        process.cwd(),
        "safari",
        "Translect",
        "Translect",
        "Translect.xcodeproj",
        "project.pbxproj"
      ),
      "utf8"
    );

    expect(project).toContain("PRODUCT_BUNDLE_IDENTIFIER = com.translect.safari;");
    expect(project).toContain("PRODUCT_BUNDLE_IDENTIFIER = com.translect.safari.Extension;");
  });

  test("connects the Safari native handler to the shared Vision OCR code", async () => {
    const projectRoot = path.join(
      process.cwd(),
      "safari",
      "Translect",
      "Translect"
    );
    const [project, handler] = await Promise.all([
      readFile(path.join(projectRoot, "Translect.xcodeproj", "project.pbxproj"), "utf8"),
      readFile(
        path.join(
          projectRoot,
          "Translect Extension",
          "SafariWebExtensionHandler.swift"
        ),
        "utf8"
      )
    ]);

    expect(project).toContain("VisionOCR.swift in Sources");
    expect(project).toContain("AppleIntelligenceTranslation.swift in Sources");
    expect(project).toContain("build-safari.mjs");
    expect(project).toContain("alwaysOutOfDate = 1;");
    expect(handler).toContain("handleVisionOCRMessage");
    expect(handler).toContain("apple-intelligence-translate");
    expect(handler).toContain("handleAppleIntelligenceMessage");
  });

  test("derives the Safari extension identifier from the containing app", async () => {
    const viewController = await readFile(
      path.join(
        process.cwd(),
        "safari",
        "Translect",
        "Translect",
        "Translect",
        "ViewController.swift"
      ),
      "utf8"
    );

    expect(viewController).toContain("Bundle.main.bundleIdentifier");
    expect(viewController).toContain(".Extension");
    expect(viewController).toContain(
      String.raw`let extensionBundleIdentifier = "\(Bundle.main.bundleIdentifier ?? "com.translect.safari").Extension"`
    );
  });
});
