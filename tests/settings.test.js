import { describe, expect, test } from "vitest";

import {
  denormalizeSettings,
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
});
