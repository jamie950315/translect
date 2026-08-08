import { describe, expect, test, vi } from "vitest";

import {
  requestAppleIntelligenceWithTextFallback
} from "../src/background/apple-intelligence-text-fallback.js";

const configuredSettings = {
  apiEndpoint: "https://api.openai.com/v1/chat/completions",
  apiKey: "test-key",
  model: "gpt-5.4-mini"
};

describe("Apple Intelligence text-only fallback", () => {
  test("uses local OCR text fallback when Apple Intelligence flags sensitive content", async () => {
    const request = { id: "image-1", imageDataUrl: "data:image/png;base64,abc" };
    const requestAppleIntelligence = vi.fn().mockRejectedValue(
      new Error("May contain sensitive content")
    );
    const requestTextFallback = vi.fn().mockResolvedValue([
      { id: "image-1", translation: { blocks: [{ translatedText: "翻譯" }] } }
    ]);

    await expect(
      requestAppleIntelligenceWithTextFallback({
        request,
        requestAppleIntelligence,
        requestTextFallback,
        settings: configuredSettings
      })
    ).resolves.toEqual({
      id: "image-1",
      translation: { blocks: [{ translatedText: "翻譯" }] }
    });

    expect(requestTextFallback).toHaveBeenCalledOnce();
    expect(requestTextFallback).toHaveBeenCalledWith([request]);
  });

  test("does not use the remote fallback for unrelated Apple Intelligence failures", async () => {
    const failure = new Error("Apple Intelligence is currently unavailable.");
    const requestAppleIntelligence = vi.fn().mockRejectedValue(failure);
    const requestTextFallback = vi.fn();

    await expect(
      requestAppleIntelligenceWithTextFallback({
        request: { id: "image-1", imageDataUrl: "data:image/png;base64,abc" },
        requestAppleIntelligence,
        requestTextFallback,
        settings: configuredSettings
      })
    ).rejects.toBe(failure);

    expect(requestTextFallback).not.toHaveBeenCalled();
  });

  test("requires a configured API key before using the text-only fallback", async () => {
    const requestTextFallback = vi.fn();

    await expect(
      requestAppleIntelligenceWithTextFallback({
        request: { id: "image-1", imageDataUrl: "data:image/png;base64,abc" },
        requestAppleIntelligence: vi.fn().mockRejectedValue(
          new Error("May contain sensitive content")
        ),
        requestTextFallback,
        settings: { ...configuredSettings, apiKey: "" }
      })
    ).rejects.toThrow("Configure an OpenAI-compatible API key");

    expect(requestTextFallback).not.toHaveBeenCalled();
  });
});
