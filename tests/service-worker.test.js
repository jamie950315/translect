import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS, MESSAGE_TYPES, PAGE_ACTIONS, STORAGE_KEY } from "../src/shared/defaults.js";

let listener;
let api;
let settings;
let storageChanged;
const event = () => ({ addListener: vi.fn() });

beforeEach(async () => {
  vi.resetModules();
  settings = { ...DEFAULT_SETTINGS, useAppleIntelligence: true };
  api = {
    runtime: {
      id: "test-extension",
      onMessage: { addListener: (fn) => { listener = fn; } },
      onInstalled: event(), onStartup: event(),
      sendNativeMessage: vi.fn()
    },
    storage: { local: {
      get: vi.fn(async () => ({ [STORAGE_KEY]: settings })),
      set: vi.fn(async (value) => { settings = value[STORAGE_KEY]; })
    }, onChanged: { addListener: (fn) => { storageChanged = fn; } } },
    action: { setBadgeBackgroundColor: vi.fn(), setBadgeText: vi.fn(), setTitle: vi.fn() },
    tabs: { query: vi.fn(), sendMessage: vi.fn().mockResolvedValue({ ok: true }), captureVisibleTab: vi.fn().mockResolvedValue("data:image/png;base64,test") }
  };
  vi.stubGlobal("chrome", api);
  vi.stubGlobal("fetch", vi.fn());
  await import("../src/background/service-worker.js");
});
afterEach(() => vi.unstubAllGlobals());

const send = (message, sender = {}) => new Promise((resolve) => listener(message, sender, resolve));

describe("background integration", () => {
  test("concurrent auto-detection toggles each apply to the latest settings", async () => {
    api.tabs.query.mockResolvedValue([{ id: 1, windowId: 0 }]);
    const responses = await Promise.all([
      send({ type: MESSAGE_TYPES.TOGGLE_ALWAYS_AUTO_DETECT }),
      send({ type: MESSAGE_TYPES.TOGGLE_ALWAYS_AUTO_DETECT })
    ]);
    expect(responses.map((response) => response.settings.alwaysAutoDetect)).toEqual([true, false]);
    expect(settings.alwaysAutoDetect).toBe(false);
    expect(api.tabs.sendMessage).toHaveBeenCalledWith(1, {
      action: PAGE_ACTIONS.SETTINGS_UPDATED, type: MESSAGE_TYPES.PAGE_ACTION
    });
  });

  test("unrelated settings changes do not repeat identical action badge writes", async () => {
    await storageChanged({ [STORAGE_KEY]: { newValue: settings } }, "local");
    await storageChanged({ [STORAGE_KEY]: { newValue: { ...settings, model: "another-model" } } }, "local");
    expect(api.action.setBadgeText).toHaveBeenCalledTimes(1);
    expect(api.action.setTitle).toHaveBeenCalledTimes(1);
  });

  test("Apple Intelligence rejection stays local even with API credentials configured", async () => {
    settings = { ...settings, apiKey: "test-key" };
    api.runtime.sendNativeMessage.mockResolvedValue({ ok: false, error: "May contain sensitive content" });
    expect(await send({ type: MESSAGE_TYPES.TRANSLATE_REGION, imageDataUrl: "data:image/png;base64,test" }))
      .toEqual({ ok: false, error: "May contain sensitive content" });
    expect(fetch).not.toHaveBeenCalled();
    expect(api.runtime.sendNativeMessage).toHaveBeenCalledTimes(1);
  });

  test("does not capture another tab after the requested tab loses focus", async () => {
    api.tabs.query.mockResolvedValue([{ id: 2, windowId: 0 }]);
    expect(await send({ type: MESSAGE_TYPES.CAPTURE_VISIBLE_TAB }, { tab: { id: 1, windowId: 0 } }))
      .toMatchObject({ ok: false, error: expect.stringContaining("active tab changed") });
    expect(api.tabs.captureVisibleTab).not.toHaveBeenCalled();
  });

  test("discards a capture if focus changed while capturing", async () => {
    api.tabs.query.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([{ id: 2 }]);
    expect(await send({ type: MESSAGE_TYPES.CAPTURE_VISIBLE_TAB }, { tab: { id: 1, windowId: 0 } }))
      .toMatchObject({ ok: false, error: expect.stringContaining("active tab changed") });
  });

  test("captures the correct window including window ID zero", async () => {
    api.tabs.query.mockResolvedValue([{ id: 1 }]);
    expect(await send({ type: MESSAGE_TYPES.CAPTURE_VISIBLE_TAB }, { tab: { id: 1, windowId: 0 } }))
      .toEqual({ ok: true, dataUrl: "data:image/png;base64,test" });
    expect(api.tabs.captureVisibleTab).toHaveBeenCalledWith(0, { format: "png" });
  });
});
