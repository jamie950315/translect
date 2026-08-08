import { describe, expect, test } from "vitest";

import {
  denormalizeSettings,
  getSettingsValidationError,
  normalizeApiEndpoint,
  normalizeIosOcrEndpoint,
  normalizeSettings,
  settingsAreReady
} from "../src/shared/settings.js";

describe("settings helpers", () => {
  test("normalizes a base endpoint into chat completions", () => {
    expect(normalizeApiEndpoint("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
  });

  test("keeps a full chat completions endpoint intact", () => {
    expect(normalizeApiEndpoint("https://example.com/v1/chat/completions")).toBe(
      "https://example.com/v1/chat/completions"
    );
  });

  test("converts a responses endpoint into chat completions for compatibility", () => {
    expect(normalizeApiEndpoint("https://example.com/v1/responses")).toBe(
      "https://example.com/v1/chat/completions"
    );
  });

  test("denormalizes the endpoint for the popup form", () => {
    expect(
      denormalizeSettings(
        normalizeSettings({
          apiEndpoint: "https://api.openai.com/v1"
        })
      ).apiEndpoint
    ).toBe("https://api.openai.com/v1");
  });

  test("requires endpoint, api key, model and language", () => {
    expect(
      settingsAreReady(
        normalizeSettings({
          apiEndpoint: "https://api.openai.com/v1",
          apiKey: "key",
          model: "gpt-5.4-mini",
          targetLanguage: "Traditional Chinese"
        })
      )
    ).toBe(true);
  });

  test("normalizes iOS OCR endpoint for upload requests", () => {
    expect(normalizeIosOcrEndpoint("http://10.0.1.11:8000")).toBe(
      "http://10.0.1.11:8000/upload"
    );
    expect(normalizeIosOcrEndpoint("http://10.0.1.11:8000/upload")).toBe(
      "http://10.0.1.11:8000/upload"
    );
  });

  test("preserves iOS OCR settings", () => {
    const settings = normalizeSettings({
      apiEndpoint: "https://api.openai.com/v1",
      apiKey: "key",
      iosOcrEndpoint: "http://10.0.1.11:8000",
      model: "gpt-5.4-mini",
      targetLanguage: "Traditional Chinese",
      useIosOcrServer: true
    });

    expect(settings.useIosOcrServer).toBe(true);
    expect(settings.iosOcrEndpoint).toBe("http://10.0.1.11:8000/upload");
    expect(denormalizeSettings(settings).iosOcrEndpoint).toBe("http://10.0.1.11:8000");
  });

  test("preserves macOS Vision OCR settings and host name", () => {
    const settings = normalizeSettings({
      apiEndpoint: "https://api.openai.com/v1",
      apiKey: "key",
      macosVisionHostName: "com.example.ocr",
      model: "gpt-5.4-mini",
      targetLanguage: "Traditional Chinese",
      useMacosVisionOcr: true
    });

    expect(settings.useMacosVisionOcr).toBe(true);
    expect(settings.macosVisionHostName).toBe("com.example.ocr");
    expect(denormalizeSettings(settings).macosVisionHostName).toBe("com.example.ocr");
  });

  test("keeps macOS Vision OCR and iOS OCR mutually exclusive", () => {
    const settings = normalizeSettings({
      useIosOcrServer: true,
      useMacosVisionOcr: true
    });

    expect(settings.useMacosVisionOcr).toBe(true);
    expect(settings.useIosOcrServer).toBe(false);
  });

  test("keeps Apple Intelligence mutually exclusive with remote OCR providers", () => {
    const settings = normalizeSettings({
      useAppleIntelligence: true,
      useIosOcrServer: true,
      useMacosVisionOcr: true
    });

    expect(settings.useAppleIntelligence).toBe(true);
    expect(settings.useMacosVisionOcr).toBe(false);
    expect(settings.useIosOcrServer).toBe(false);
  });

  test("does not require remote API credentials in Apple Intelligence mode", () => {
    const settings = normalizeSettings({
      apiEndpoint: "",
      apiKey: "",
      model: "",
      targetLanguage: "Traditional Chinese",
      useAppleIntelligence: true
    });

    expect(settingsAreReady(settings)).toBe(true);
    expect(getSettingsValidationError(settings)).toBe("");
  });

  test("still requires a target language in Apple Intelligence mode", () => {
    const settings = {
      ...normalizeSettings({ useAppleIntelligence: true }),
      targetLanguage: ""
    };

    expect(settingsAreReady(settings)).toBe(false);
    expect(getSettingsValidationError(settings)).toBe("Target language is required.");
  });
});
