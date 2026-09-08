import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS, MESSAGE_TYPES, STORAGE_KEY } from "../src/shared/defaults.js";

let listener;
let api;
let settings;
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
    storage: { local: { get: vi.fn(async () => ({ [STORAGE_KEY]: settings })) }, onChanged: event() },
    tabs: { query: vi.fn(), captureVisibleTab: vi.fn().mockResolvedValue("data:image/png;base64,test") }
  };
  vi.stubGlobal("chrome", api);
  vi.stubGlobal("fetch", vi.fn());
  await import("../src/background/service-worker.js");
});
afterEach(() => vi.unstubAllGlobals());

const send = (message, sender = {}) => new Promise((resolve) => listener(message, sender, resolve));

describe("background integration", () => {
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
