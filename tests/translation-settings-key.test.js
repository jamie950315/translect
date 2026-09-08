import { describe, expect, test } from "vitest";
import { translationSettingsKey } from "../src/content/translation-settings-key.js";

describe("translation cache settings identity", () => {
  test("distinguishes API routes and case-sensitive model names", () => {
    const settings = { targetLanguage: "Traditional Chinese", model: "Provider/Model", apiEndpoint: "https://example.com/v1" };
    expect(translationSettingsKey(settings)).not.toBe(translationSettingsKey({ ...settings, apiEndpoint: "https://other.example/v1" }));
    expect(translationSettingsKey(settings)).not.toBe(translationSettingsKey({ ...settings, apiEndpoint: "https://example.com/v2" }));
    expect(translationSettingsKey(settings)).not.toBe(translationSettingsKey({ ...settings, model: "provider/model" }));
  });

  test("does not persist API keys, URL credentials or query secrets", () => {
    const key = translationSettingsKey({
      apiEndpoint: "https://user:password@example.com/v1?key=secret#token",
      apiKey: "private-key",
      useIosOcrServer: true,
      iosOcrEndpoint: "https://ocr:password@example.com/upload?token=secret"
    });
    expect(key).toBe("||https://example.com/v1|ios-ocr:https://example.com/upload");
    expect(key).not.toMatch(/user|password|secret|token|private-key/);
  });

  test("local Apple Intelligence does not depend on remote model settings", () => {
    expect(translationSettingsKey({ useAppleIntelligence: true, model: "a", apiEndpoint: "https://a.example" }))
      .toBe(translationSettingsKey({ useAppleIntelligence: true, model: "b", apiEndpoint: "https://b.example" }));
  });
});
