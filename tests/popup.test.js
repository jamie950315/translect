import { afterEach, expect, test, vi } from "vitest";
import { MESSAGE_TYPES } from "../src/shared/defaults.js";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

async function loadPopup(sendMessage) {
  const elements = new Map();
  vi.stubGlobal("document", { getElementById(id) {
    if (!elements.has(id)) elements.set(id, {
      value: "", checked: false, disabled: false, style: {}, textContent: "", listeners: {},
      attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, focus() {},
      addEventListener(event, handler) { this.listeners[event] = handler; }
    });
    return elements.get(id);
  } });
  vi.stubGlobal("chrome", { runtime: { id: "test", sendMessage } });
  vi.stubGlobal("window", { close: vi.fn() });
  await import("../src/popup/popup.js");
  await new Promise((resolve) => setTimeout(resolve, 0));
  return elements;
}

test("failed settings load is visible and cannot overwrite saved settings", async () => {
  const elements = await loadPopup(async () => ({ ok: false, error: "Storage is unavailable" }));
  expect(elements.get("status").textContent).toBe("Storage is unavailable");
  for (const id of ["saveButton", "manualButton", "autoButton"]) expect(elements.get(id).disabled).toBe(true);
});

test("late shortcut initialization cannot erase a save failure", async () => {
  let resolveCommands;
  const e = await loadPopup(async ({ type }) => {
    if (type === MESSAGE_TYPES.GET_SETTINGS) return { ok: true, settings: {} };
    if (type === MESSAGE_TYPES.GET_COMMANDS) return new Promise((resolve) => { resolveCommands = resolve; });
    return { ok: false, error: "Save rejected" };
  });
  await e.get("saveButton").listeners.click();
  resolveCommands({ ok: true, commands: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(e.get("status").textContent).toBe("Save rejected");
});

test("tabs support arrow-key navigation without changing settings", async () => {
  const send = vi.fn(async ({ type }) => type === MESSAGE_TYPES.GET_SETTINGS
    ? { ok: true, settings: { apiKey: "stored-key" } } : { ok: true, commands: [] });
  const e = await loadPopup(send);
  e.get("translateTab").listeners.keydown({ key: "ArrowRight", preventDefault() {} });
  expect(e.get("settingsPanel").hidden).toBe(false);
  expect(e.get("translatePanel").hidden).toBe(true);
  expect(e.get("settingsTab").attributes["aria-selected"]).toBe("true");
  expect(e.get("apiKey").value).toBe("stored-key");
  expect(send).toHaveBeenCalledTimes(2);
});

test("provider choices are mutually exclusive and preserve hidden credentials", async () => {
  const e = await loadPopup(async ({ type }) => type === MESSAGE_TYPES.GET_SETTINGS
    ? { ok: true, settings: { apiKey: "stored-key" }, settingsRetainedOnMac: true } : { ok: true, commands: [] });
  e.get("providerSelect").value = "apple";
  e.get("providerSelect").listeners.change();
  expect(e.get("remoteApiSettings").hidden).toBe(true);
  e.get("providerSelect").value = "ios";
  e.get("providerSelect").listeners.change();
  expect(e.get("providerSelect").value).toBe("ios");
  expect(e.get("iosOcrSettings").hidden).toBe(false);
  expect(e.get("apiKey").value).toBe("stored-key");
  expect(e.get("storageLabel").textContent).toBe("On this Mac");
});

test.each(["api", "apple", "macos", "ios"])("native method picker preserves the stored flags for %s", async (method) => {
  const send = vi.fn(async ({ type }) => {
    if (type === MESSAGE_TYPES.GET_SETTINGS) return { ok: true, settings: { apiKey: "stored-key" } };
    if (type === MESSAGE_TYPES.GET_COMMANDS) return { ok: true, commands: [] };
    return { ok: true };
  });
  const e = await loadPopup(send);
  e.get("providerSelect").value = method;
  e.get("providerSelect").listeners.change();
  await e.get("saveButton").listeners.click();
  const saved = send.mock.calls.find(([m]) => m.type === MESSAGE_TYPES.SAVE_SETTINGS)[0].settings;
  expect(saved).toMatchObject({ apiKey: "stored-key", useAppleIntelligence: method === "apple", useMacosVisionOcr: method === "macos", useIosOcrServer: method === "ios" });
});

test("selection button stays manual even when the shortcut uses auto mode", async () => {
  const send = vi.fn(async ({ type }) => {
    if (type === MESSAGE_TYPES.GET_SETTINGS) return { ok: true, settings: { triggerUsesAutoMode: true } };
    if (type === MESSAGE_TYPES.GET_COMMANDS) return { ok: true, commands: [] };
    return { ok: true };
  });
  const e = await loadPopup(send);
  await e.get("manualButton").listeners.click();
  expect(send).toHaveBeenLastCalledWith({ type: MESSAGE_TYPES.DISPATCH_ACTIVE_TAB, action: "start-manual-selection" });
});

test("busy actions prevent duplicate requests and release controls on failure", async () => {
  let rejectSave;
  const send = vi.fn(async ({ type }) => {
    if (type === MESSAGE_TYPES.GET_SETTINGS) return { ok: true, settings: {} };
    if (type === MESSAGE_TYPES.GET_COMMANDS) return { ok: true, commands: [] };
    return new Promise((_resolve, reject) => { rejectSave = reject; });
  });
  const e = await loadPopup(send);
  const first = e.get("saveButton").listeners.click();
  await e.get("saveButton").listeners.click();
  expect(e.get("settingsFields").disabled).toBe(true);
  expect(send.mock.calls.filter(([m]) => m.type === MESSAGE_TYPES.SAVE_SETTINGS)).toHaveLength(1);
  rejectSave(new Error("Keychain locked"));
  await first;
  expect(e.get("saveButton").disabled).toBe(false);
  expect(e.get("status").textContent).toBe("Keychain locked");
  expect(e.get("status").attributes["data-kind"]).toBe("error");
});

test("a successful load enables actions but reports shortcut discovery errors", async () => {
  const elements = await loadPopup(async ({ type }) => type === MESSAGE_TYPES.GET_SETTINGS
    ? { ok: true, settings: { apiKey: "stored-key" } }
    : { ok: false, error: "Command discovery failed" });
  expect(elements.get("apiKey").value).toBe("stored-key");
  expect(elements.get("saveButton").disabled).toBe(false);
  expect(elements.get("status").textContent).toBe("Command discovery failed");
});

test("saving reports a failed page update instead of showing success", async () => {
  const elements = await loadPopup(async ({ type }) => {
    if (type === MESSAGE_TYPES.GET_SETTINGS) return { ok: true, settings: {} };
    if (type === MESSAGE_TYPES.GET_COMMANDS) return { ok: true, commands: [] };
    if (type === MESSAGE_TYPES.SAVE_SETTINGS) return { ok: true };
    return { ok: false, error: "Page was closed" };
  });
  await elements.get("saveButton").listeners.click();
  expect(elements.get("status").textContent).toBe("Page was closed");
});
