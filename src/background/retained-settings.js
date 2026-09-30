import { DEFAULT_SETTINGS, STORAGE_KEY } from "../shared/defaults.js";
import { normalizeSettings } from "../shared/settings.js";

// Safari's signed app owns the stable Keychain identity. Chromium continues to
// use browser storage without requiring an OCR host just to configure an API.
export function usesMacSettingsRetention(globalObject = globalThis) {
  return Boolean(globalObject.browser?.runtime &&
    globalObject.chrome?.runtime === globalObject.browser.runtime);
}

export function createRetainedSettingsStore({ storage, nativeRequest }) {
  let queue = Promise.resolve();
  function serialize(operation) {
    const result = queue.then(operation);
    // Keep the queue usable after an error; the caller still receives rejection.
    queue = result.catch(() => {});
    return result;
  }

  async function native(operation, settings, onlyIfMissing = false) {
    const response = await nativeRequest({ operation, ...(settings ? { settings } : {}),
      ...(onlyIfMissing ? { onlyIfMissing: true } : {}) });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not access settings retained on this Mac.");
    }
    if ((response.settings === null && operation !== "settings-load") ||
        (response.settings !== null && (!response.settings ||
        typeof response.settings !== "object" || Array.isArray(response.settings) ||
        !Object.entries(DEFAULT_SETTINGS).every(([key, value]) => typeof response.settings[key] === typeof value)))) {
      throw new Error("The Mac settings response is invalid.");
    }
    return response.settings;
  }

  function cacheValue(settings) {
    return nativeRequest ? { ...settings, apiKey: "" } : settings;
  }

  async function cache(settings, previous) {
    const value = cacheValue(settings);
    if (JSON.stringify(previous) !== JSON.stringify(value)) {
      await storage.set({ [STORAGE_KEY]: value });
    }
  }

  async function read() {
    const local = (await storage.get(STORAGE_KEY))[STORAGE_KEY];
    if (!nativeRequest) return normalizeSettings(local || DEFAULT_SETTINGS);

    const retained = await native("settings-load");
    if (retained !== null) {
      const settings = normalizeSettings(retained);
      await cache(settings, local);
      return settings;
    }
    // Migrate existing browser settings once. A brand-new installation must not
    // publish defaults before the user has saved any settings.
    if (local) {
      const settings = normalizeSettings(await native("settings-save", normalizeSettings(local), true));
      await cache(settings, local);
      return settings;
    }
    return normalizeSettings(DEFAULT_SETTINGS);
  }

  async function write(update) {
    const current = await read();
    const settings = normalizeSettings({ ...current, ...update(current) });
    if (nativeRequest) await native("settings-save", settings);
    await storage.set({ [STORAGE_KEY]: cacheValue(settings) });
    return settings;
  }

  return {
    get: () => serialize(read),
    save: (input = {}) => serialize(() => write(() => input)),
    update: (update) => serialize(() => write(update))
  };
}
