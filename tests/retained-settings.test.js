import { describe, expect, test, vi } from "vitest";
import { createRetainedSettingsStore, usesMacSettingsRetention } from "../src/background/retained-settings.js";
import { DEFAULT_SETTINGS, STORAGE_KEY } from "../src/shared/defaults.js";
import { normalizeSettings } from "../src/shared/settings.js";

const profile = normalizeSettings({ ...DEFAULT_SETTINGS, apiKey: "test-key", model: "test-model", alwaysAutoDetect: true });
function setup({ local, retained = null, mac = true } = {}) {
  let browser = local;
  let record = retained;
  const storage = {
    get: vi.fn(async () => ({ [STORAGE_KEY]: browser })),
    set: vi.fn(async (value) => { browser = value[STORAGE_KEY]; })
  };
  const native = vi.fn(async ({ operation, settings, onlyIfMissing }) => {
    if (operation === "settings-save" && !(onlyIfMissing && record)) record = settings;
    return { ok: true, settings: record };
  });
  const store = createRetainedSettingsStore({ storage, nativeRequest: mac ? native : null });
  return { store, native, storage, local: () => browser, retained: () => record };
}

describe("Mac automatic settings retention", () => {
  test("restores a fresh browser without putting its API key in browser storage", async () => {
    const s = setup({ retained: profile });
    expect(await s.store.get()).toEqual(profile);
    expect(s.local()).toEqual({ ...profile, apiKey: "" });
    expect(s.native).toHaveBeenCalledTimes(1);
  });
  test("migrates an existing profile only if no Mac profile exists", async () => {
    const s = setup({ local: profile });
    expect(await s.store.get()).toEqual(profile);
    expect(s.retained()).toEqual(profile);
    expect(s.native).toHaveBeenLastCalledWith({ operation: "settings-save", settings: profile, onlyIfMissing: true });
    expect(s.local().apiKey).toBe("");
  });
  test("does not overwrite a concurrent profile during first migration", async () => {
    const newer = { ...profile, model: "newer" };
    const s = setup({ local: profile });
    s.native.mockResolvedValueOnce({ ok: true, settings: null }).mockResolvedValueOnce({ ok: true, settings: newer });
    expect(await s.store.get()).toEqual(newer);
    expect(s.local().model).toBe("newer");
  });
  test("does not publish defaults from a new empty installation", async () => {
    const s = setup();
    expect(await s.store.get()).toEqual(normalizeSettings(DEFAULT_SETTINGS));
    expect(s.retained()).toBeNull();
    expect(s.storage.set).not.toHaveBeenCalled();
    expect(s.native).toHaveBeenCalledTimes(1);
  });
  test("a retained profile takes precedence over a stale browser cache", async () => {
    const s = setup({ local: { ...profile, model: "old" }, retained: profile });
    expect((await s.store.get()).model).toBe("test-model");
    expect(s.retained()).toEqual(profile);
  });
  test("saves all settings and explicit API key clearing", async () => {
    const s = setup({ retained: profile });
    expect(await s.store.save({ apiKey: "", useMacosVisionOcr: true })).toMatchObject({ apiKey: "", useMacosVisionOcr: true });
    expect(s.retained()).toMatchObject({ apiKey: "", useMacosVisionOcr: true, model: "test-model" });
  });
  test("retains browser data if Keychain is locked and allows retry", async () => {
    const s = setup({ local: profile });
    s.native.mockResolvedValueOnce({ ok: false, error: "Keychain locked" });
    await expect(s.store.get()).rejects.toThrow("Keychain locked");
    expect(s.local()).toEqual(profile);
    expect(await s.store.get()).toEqual(profile);
  });
  test("a failed Mac save does not update the browser cache", async () => {
    const s = setup({ retained: profile });
    await s.store.get();
    s.native.mockResolvedValueOnce({ ok: true, settings: profile }).mockResolvedValueOnce({ ok: false, error: "Write denied" });
    await expect(s.store.save({ model: "lost" })).rejects.toThrow("Write denied");
    expect(s.local().model).toBe("test-model");
  });
  test.each([undefined, {}, [], { ...profile, alwaysAutoDetect: "yes" }])("rejects malformed retained settings: %j", async (settings) => {
    const s = setup({ local: profile });
    s.native.mockResolvedValue({ ok: true, settings });
    await expect(s.store.get()).rejects.toThrow("response is invalid");
    expect(s.storage.set).not.toHaveBeenCalled();
  });
  test("serializes partial updates without dropping previously saved values", async () => {
    const s = setup({ retained: profile });
    await Promise.all([s.store.save({ model: "one" }), s.store.save({ targetLanguage: "Japanese" })]);
    expect(s.retained()).toMatchObject({ model: "one", targetLanguage: "Japanese", apiKey: "test-key" });
  });
  test("Chromium continues to work without a native messaging host", async () => {
    const s = setup({ local: profile, mac: false });
    await s.store.save({ model: "new" });
    expect(s.local()).toMatchObject({ model: "new", apiKey: "test-key" });
    expect(s.native).not.toHaveBeenCalled();
  });
  test("enables retention only for the Safari API namespace", () => {
    const runtime = {};
    expect(usesMacSettingsRetention({ chrome: { runtime } })).toBe(false);
    expect(usesMacSettingsRetention({ chrome: { runtime }, browser: { runtime } })).toBe(true);
  });
});
