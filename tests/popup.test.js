import { afterEach, expect, test, vi } from "vitest";
import { MESSAGE_TYPES } from "../src/shared/defaults.js";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

async function loadPopup(sendMessage) {
  const elements = new Map();
  vi.stubGlobal("document", { getElementById(id) {
    if (!elements.has(id)) elements.set(id, {
      value: "", checked: false, disabled: false, style: {}, textContent: "", listeners: {},
      addEventListener(event, handler) { this.listeners[event] = handler; }
    });
    return elements.get(id);
  } });
  vi.stubGlobal("chrome", { runtime: { id: "test", sendMessage } });
  await import("../src/popup/popup.js");
  await new Promise((resolve) => setTimeout(resolve, 0));
  return elements;
}

test("failed settings load is visible and cannot overwrite saved settings", async () => {
  const elements = await loadPopup(async () => ({ ok: false, error: "Storage is unavailable" }));
  expect(elements.get("status").textContent).toBe("Storage is unavailable");
  for (const id of ["saveButton", "manualButton", "autoButton"]) expect(elements.get(id).disabled).toBe(true);
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
