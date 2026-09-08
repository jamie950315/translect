import { afterEach, describe, expect, test, vi } from "vitest";
import { MESSAGE_TYPES, PAGE_ACTIONS } from "../src/shared/defaults.js";

async function setup(settings = {}) {
  vi.resetModules();
  const nodes = new Map();
  const toasts = [];
  function element() {
    const node = {
      style: { removeProperty() {} },
      append(...children) {
        for (const child of children) {
          if (child.id) nodes.set(child.id, child);
          if (child.className === "translect-toast") toasts.push(child.textContent);
        }
      },
      remove() {},
      querySelector: () => node,
      setAttribute() {},
      addEventListener() {},
      getContext: () => ({ canvas: node, drawImage() {} })
    };
    return node;
  }
  const image = {
    complete: true,
    naturalWidth: 300,
    naturalHeight: 200,
    src: "https://example.com/image.png",
    getBoundingClientRect: () => ({ x: 10, y: 10, width: 300, height: 200, top: 10, left: 10, bottom: 210, right: 310 })
  };
  const sendMessage = vi.fn(async (message) => {
    if (message.type === MESSAGE_TYPES.GET_SETTINGS) return { ok: true, settings };
    if (message.type === MESSAGE_TYPES.FETCH_IMAGE_DATA) return { ok: true, dataUrl: "data:image/png;base64,test" };
    if (message.type === MESSAGE_TYPES.TRANSLATE_REGION) return { ok: true, translation: { blocks: [] } };
    if (message.type === MESSAGE_TYPES.TRANSLATE_REGIONS) return { ok: true, translations: message.requests.map(({ id }) => ({ id, translation: { blocks: [] } })) };
    throw new Error(`Unexpected message ${message.type}`);
  });
  vi.stubGlobal("document", {
    readyState: "loading",
    images: [image],
    documentElement: element(),
    createElement: element,
    getElementById: (id) => nodes.get(id)
  });
  vi.stubGlobal("window", {
    location: { href: "https://example.com/", hostname: "example.com" },
    innerWidth: 1200,
    innerHeight: 900,
    addEventListener() {},
    setTimeout() {},
    requestAnimationFrame: (callback) => callback()
  });
  vi.stubGlobal("Image", class {
    width = 300;
    height = 200;
    set src(value) { queueMicrotask(() => this.onload()); }
  });
  vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener() {}, removeListener() {} } } });
  await import("../src/content/content-script.js");
  const action = (action = PAGE_ACTIONS.AUTO_TRANSLATE_VISIBLE) => new Promise((resolve) => {
    window.__translectRuntimeMessageHandler({ type: MESSAGE_TYPES.PAGE_ACTION, action }, null, resolve);
  });
  return { action, sendMessage, toasts, nodes };
}

afterEach(() => vi.unstubAllGlobals());

describe("content script translation error reporting", () => {
  test("automatic scanning ignores its own toast and overlay mutations", async () => {
    const { action, nodes } = await setup({ alwaysAutoDetect: true });
    let notify;
    vi.stubGlobal("MutationObserver", class {
      constructor(callback) { notify = callback; }
      observe() {}
    });
    window.setTimeout = vi.fn();
    expect(await action(PAGE_ACTIONS.SETTINGS_UPDATED)).toEqual({ ok: true });
    window.setTimeout.mockClear();
    notify([{ target: { closest: () => nodes }, addedNodes: [{}], removedNodes: [] }]);
    notify([{ target: {}, addedNodes: [{ id: "__translect-root" }, { id: "__translect-styles" }], removedNodes: [] }]);
    expect(window.setTimeout).not.toHaveBeenCalled();
    notify([{ target: {}, addedNodes: [{}], removedNodes: [] }]);
    expect(window.setTimeout).toHaveBeenCalledTimes(1);
  });

  test("returns the real translation failure instead of reporting success", async () => {
    const { action, sendMessage, toasts } = await setup();
    const implementation = sendMessage.getMockImplementation();
    sendMessage.mockImplementation((message) => message.type === MESSAGE_TYPES.TRANSLATE_REGION
      ? { ok: false, error: "API quota exhausted" }
      : implementation(message));
    expect(await action()).toMatchObject({ ok: false, error: expect.stringContaining("API quota exhausted") });
    expect(toasts).toContain("Image translation failed: API quota exhausted");
    expect(toasts).not.toContain("Visible image translation finished.");
  });

  test("releases an iOS image after preparation failure so it can be retried", async () => {
    const { action, sendMessage } = await setup({ useIosOcrServer: true });
    const implementation = sendMessage.getMockImplementation();
    let fail = true;
    sendMessage.mockImplementation((message) => {
      if (fail && message.type === MESSAGE_TYPES.FETCH_IMAGE_DATA) throw new Error("Connection lost");
      return implementation(message);
    });
    expect(await action()).toMatchObject({ ok: false, error: expect.stringContaining("Connection lost") });
    fail = false;
    expect(await action()).toEqual({ ok: true });
    expect(sendMessage.mock.calls.filter(([message]) => message.type === MESSAGE_TYPES.TRANSLATE_REGIONS)).toHaveLength(1);
  });

  test.each([undefined, [], [{ id: "wrong", translation: { blocks: [] } }]])("rejects incomplete iOS batch results: %j", async (translations) => {
    const { action, sendMessage, toasts } = await setup({ useIosOcrServer: true });
    const implementation = sendMessage.getMockImplementation();
    sendMessage.mockImplementation((message) => message.type === MESSAGE_TYPES.TRANSLATE_REGIONS
      ? { ok: true, translations }
      : implementation(message));
    expect(await action()).toMatchObject({ ok: false, error: expect.stringContaining("missing or invalid results") });
    expect(toasts).not.toContain("Visible image translation finished.");
  });

  test.each([false, true])("explicit translation refreshes an existing translation (iOS: %s)", async (useIosOcrServer) => {
    const { action, sendMessage } = await setup({ useIosOcrServer });
    const implementation = sendMessage.getMockImplementation();
    // Tiny regions are omitted by rendering, while still recording the successful image.
    const translation = { blocks: [{ bounds: { x: 0, y: 0, width: 0.001, height: 0.001 } }] };
    sendMessage.mockImplementation((message) => {
      if (message.type === MESSAGE_TYPES.TRANSLATE_REGION) return { ok: true, translation };
      if (message.type === MESSAGE_TYPES.TRANSLATE_REGIONS) return { ok: true, translations: message.requests.map(({ id }) => ({ id, translation })) };
      return implementation(message);
    });
    expect(await action()).toEqual({ ok: true });
    expect(await action()).toEqual({ ok: true });
    const type = useIosOcrServer ? MESSAGE_TYPES.TRANSLATE_REGIONS : MESSAGE_TYPES.TRANSLATE_REGION;
    expect(sendMessage.mock.calls.filter(([message]) => message.type === type)).toHaveLength(2);
  });

  test("does not silently replace a settings failure with defaults", async () => {
    const { action, sendMessage } = await setup();
    sendMessage.mockResolvedValue({ ok: false, error: "Settings storage unavailable" });
    expect(await action()).toEqual({ ok: false, error: "Settings storage unavailable" });
  });
});
