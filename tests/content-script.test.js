import { afterEach, describe, expect, test, vi } from "vitest";
import { MESSAGE_TYPES, PAGE_ACTIONS, STORAGE_KEY } from "../src/shared/defaults.js";

async function setup(settings = {}) {
  vi.resetModules();
  const nodes = new Map();
  const toasts = [];
  const events = new Map();
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
    isConnected: true,
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
    getElementById: (id) => nodes.get(id),
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: (name) => events.delete(name)
  });
  vi.stubGlobal("window", {
    location: { href: "https://example.com/", hostname: "example.com" },
    innerWidth: 1200,
    innerHeight: 900,
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: (name) => events.delete(name),
    setTimeout: vi.fn(),
    requestAnimationFrame: (callback) => callback()
  });
  vi.stubGlobal("Image", class {
    width = 300;
    height = 200;
    set src(value) { queueMicrotask(() => this.onload()); }
  });
  vi.stubGlobal("chrome", {
    runtime: { sendMessage, onMessage: { addListener() {}, removeListener() {} } },
    storage: { local: { get: vi.fn(async () => ({ [STORAGE_KEY]: settings })) } }
  });
  await import("../src/content/content-script.js");
  const action = (action = PAGE_ACTIONS.AUTO_TRANSLATE_VISIBLE) => new Promise((resolve) => {
    window.__translectRuntimeMessageHandler({ type: MESSAGE_TYPES.PAGE_ACTION, action }, null, resolve);
  });
  return { action, sendMessage, toasts, nodes, image, events };
}

async function runAutoScan() {
  const callback = window.setTimeout.mock.calls.filter(([, delay]) => delay === 450).at(-1)?.[0];
  expect(callback).toBeTypeOf("function");
  callback();
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

afterEach(() => vi.unstubAllGlobals());

describe("content script translation error reporting", () => {
  test("does not automatically repeat a no-text result", async () => {
    vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
    const { action, sendMessage, events } = await setup({ alwaysAutoDetect: true });
    await action(PAGE_ACTIONS.SETTINGS_UPDATED);
    await runAutoScan();
    events.get("scroll")();
    await runAutoScan();
    expect(sendMessage.mock.calls.filter(([message]) => message.type === MESSAGE_TYPES.TRANSLATE_REGION)).toHaveLength(1);
    expect(await action()).toEqual({ ok: true });
    expect(sendMessage.mock.calls.filter(([message]) => message.type === MESSAGE_TYPES.TRANSLATE_REGION)).toHaveLength(2);
  });

  test("does not retry an automatic error on page activity and allows explicit recovery", async () => {
    vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
    const { action, sendMessage, events } = await setup({ alwaysAutoDetect: true });
    const implementation = sendMessage.getMockImplementation();
    let fail = true;
    sendMessage.mockImplementation((message) => message.type === MESSAGE_TYPES.TRANSLATE_REGION && fail
      ? { ok: false, error: "Quota exhausted" } : implementation(message));
    await action(PAGE_ACTIONS.SETTINGS_UPDATED);
    await runAutoScan();
    events.get("scroll")();
    await runAutoScan();
    expect(sendMessage.mock.calls.filter(([message]) => message.type === MESSAGE_TYPES.TRANSLATE_REGION)).toHaveLength(1);
    fail = false;
    expect(await action()).toEqual({ ok: true });
  });

  test.each([false, true])("discards an obsolete single/batched image (iOS: %s)", async (useIosOcrServer) => {
    const { action, sendMessage, image, nodes } = await setup({ useIosOcrServer });
    const implementation = sendMessage.getMockImplementation();
    let complete;
    let requests;
    sendMessage.mockImplementation((message) => {
      if ([MESSAGE_TYPES.TRANSLATE_REGION, MESSAGE_TYPES.TRANSLATE_REGIONS].includes(message.type)) {
        requests = message.requests;
        return new Promise((resolve) => { complete = resolve; });
      }
      return implementation(message);
    });
    const translating = action();
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    image.src = "https://example.com/replaced.png";
    const rootAppend = vi.spyOn(nodes.get("__translect-root"), "append");
    const translation = { blocks: [{ bounds: { x: 0, y: 0, width: 0.001, height: 0.001 } }] };
    complete({ ok: true, translation, translations: requests?.map(({ id }) => ({ id, translation })) });
    expect(await translating).toEqual({ ok: true });
    expect(rootAppend.mock.calls.flat().some((node) => node?.className === "translect-overlay")).toBe(false);
  });

  test.each(["detached", "clear", "settings"])("discards a result after lifecycle invalidation: %s", async (change) => {
    const { action, sendMessage, image, nodes } = await setup();
    const implementation = sendMessage.getMockImplementation();
    let complete;
    sendMessage.mockImplementation((message) => message.type === MESSAGE_TYPES.TRANSLATE_REGION
      ? new Promise((resolve) => { complete = resolve; }) : implementation(message));
    const translating = action();
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    if (change === "detached") image.isConnected = false;
    if (change === "clear") await action(PAGE_ACTIONS.CLEAR_OVERLAYS);
    if (change === "settings") await action(PAGE_ACTIONS.SETTINGS_UPDATED);
    const append = vi.spyOn(nodes.get("__translect-root"), "append");
    complete({ ok: true, translation: { blocks: [{ bounds: { x: 0, y: 0, width: 0.001, height: 0.001 } }] } });
    await translating;
    expect(append.mock.calls.flat().some((node) => node?.className === "translect-overlay")).toBe(false);
  });

  test("defers automatic work while hidden and resumes when visible", async () => {
    vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
    const { action, events, sendMessage } = await setup({ alwaysAutoDetect: true });
    document.hidden = true;
    await action(PAGE_ACTIONS.SETTINGS_UPDATED);
    expect(window.setTimeout).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    document.hidden = false;
    events.get("visibilitychange")();
    await runAutoScan();
    expect(sendMessage.mock.calls.filter(([message]) => message.type === MESSAGE_TYPES.TRANSLATE_REGION)).toHaveLength(1);
  });

  test("resumes an image scan that arrived during another translation", async () => {
    vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
    const { action, sendMessage, image, events } = await setup({ alwaysAutoDetect: true });
    const implementation = sendMessage.getMockImplementation();
    let complete;
    sendMessage.mockImplementation((message) => message.type === MESSAGE_TYPES.TRANSLATE_REGION
      ? new Promise((resolve) => { complete = resolve; }) : implementation(message));
    await action(PAGE_ACTIONS.SETTINGS_UPDATED);
    await runAutoScan();
    expect(complete).toBeTypeOf("function");
    image.src = "https://example.com/new-image.png";
    events.get("scroll")();
    await runAutoScan();
    window.setTimeout.mockClear();
    complete({ ok: true, translation: { blocks: [] } });
    for (let index = 0; index < 30; index += 1) await Promise.resolve();
    expect(window.setTimeout.mock.calls.some(([, delay]) => delay === 450)).toBe(true);
    sendMessage.mockImplementation(implementation);
    await runAutoScan();
    expect(sendMessage.mock.calls.filter(([message]) => message.type === MESSAGE_TYPES.TRANSLATE_REGION)).toHaveLength(2);
  });

  test("does not let an older settings read overwrite the latest profile", async () => {
    vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
    const { action } = await setup();
    let oldRead;
    chrome.storage.local.get.mockImplementationOnce(() => new Promise((resolve) => { oldRead = resolve; }));
    const oldApply = action(PAGE_ACTIONS.SETTINGS_UPDATED);
    await vi.waitFor(() => expect(oldRead).toBeTypeOf("function"));
    chrome.storage.local.get.mockResolvedValue({ [STORAGE_KEY]: { alwaysAutoDetect: true } });
    await action(PAGE_ACTIONS.SETTINGS_UPDATED);
    window.setTimeout.mockClear();
    oldRead({ [STORAGE_KEY]: { alwaysAutoDetect: false } });
    await oldApply;
    expect(window.setTimeout.mock.calls.some(([, delay]) => delay === 450)).toBe(true);
  });

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
    const { action } = await setup();
    chrome.storage.local.get.mockRejectedValue(new Error("Settings storage unavailable"));
    expect(await action()).toEqual({ ok: false, error: "Settings storage unavailable" });
  });

  test("settings refresh replies without a nested background message", async () => {
    const { action, sendMessage } = await setup();
    expect(await action(PAGE_ACTIONS.SETTINGS_UPDATED)).toEqual({ ok: true });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
