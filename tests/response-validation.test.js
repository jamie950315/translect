import { describe, expect, test } from "vitest";
import { parseTranslationResponse } from "../src/shared/api.js";
import { normalizeIosOcrResult, mergeOcrAndTranslationResults } from "../src/shared/ios-ocr.js";
import { normalizeMacosVisionOcrResult, normalizeAppleIntelligenceResult, mergeMacosVisionTranslationResults } from "../src/shared/macos-vision-ocr.js";
import { normalizeSettings, settingsAreReady } from "../src/shared/settings.js";
import { fitFontSize } from "../src/shared/render-utils.js";

test("only an explicit empty blocks array means no image text", () => {
  expect(parseTranslationResponse('{"blocks":[]}')).toEqual({ blocks: [] });
  for (const value of ['{}', '{"blocks":null}', '{"blocks":[{}]}']) {
    expect(() => parseTranslationResponse(value)).toThrow();
  }
});

test("rejects text with missing coordinates instead of drawing it at the origin", () => {
  expect(() => parseTranslationResponse(JSON.stringify({ blocks: [{
    translated_text: "hello", bounds: { width: 10, height: 10 }
  }] }))).toThrow("invalid bounds");
});

test.each([normalizeIosOcrResult, normalizeMacosVisionOcrResult, normalizeAppleIntelligenceResult])(
  "rejects malformed OCR responses without inventing image dimensions", (normalize) => {
    expect(() => normalize("a", {})).toThrow("OCR response");
    expect(() => normalize("a", { image_width: 0, image_height: 10, observations: [], ocr_boxes: [] })).toThrow("OCR response");
    expect(() => normalize("a", { image_width: 10, image_height: 10, observations: [], ocr_boxes: [] })).not.toThrow();
  }
);

describe.each([
  ["iOS", mergeOcrAndTranslationResults, "blocks", "box_id", "a:0"],
  ["macOS", mergeMacosVisionTranslationResults, "groups", "group_id", "a:flow:0"]
])("%s translation validation", (_, merge, collection, idKey, id) => {
  const inputs = [{ imageId: "a", blocks: [{ id: "a:0", flowGroupId: "a:flow:0", sourceText: "Hello" }] }];
  const item = { [idKey]: id, translated_text: "你好" };
  const response = (items, imageId = "a") => ({ images: [{ image_id: imageId, [collection]: items }] });
  test("rejects missing requested translations", () => {
    expect(() => merge(inputs, {})).toThrow("images array");
    expect(() => merge(inputs, { images: [] })).toThrow("incomplete");
    expect(() => merge(inputs, response([]))).toThrow("incomplete");
  });
  test("rejects wrong image IDs, duplicate IDs, and empty text", () => {
    expect(() => merge(inputs, response([item], "b"))).toThrow("image ID");
    expect(() => merge(inputs, response([item, item]))).toThrow("text ID");
    expect(() => merge(inputs, response([{ ...item, translated_text: " " }]))).toThrow("empty translation");
  });
  test("accepts complete translations and genuine empty OCR results", () => {
    expect(merge(inputs, response([item]))[0].translation.blocks).toHaveLength(1);
    expect(merge([{ imageId: "a", blocks: [] }], { images: [] })[0].translation.blocks).toEqual([]);
  });
});

test("readiness includes the selected OCR provider requirements", () => {
  expect(settingsAreReady({ ...normalizeSettings({ apiKey: "key", useIosOcrServer: true }), iosOcrEndpoint: "" })).toBe(false);
  expect(settingsAreReady({ ...normalizeSettings({ apiKey: "key", useMacosVisionOcr: true }), macosVisionHostName: "" })).toBe(false);
});

test("font fitting stops after the largest exact line-count match", () => {
  const sizes = new Set();
  const result = fitFontSize("Hello", { width: 1000, height: 100 }, {
    maxFontSize: 64, minFontSize: 10, targetLineCount: 1,
    measureWidth(text, size) { sizes.add(size); return text.length * size; }
  });
  expect(result.fontSize).toBe(64);
  expect([...sizes]).toEqual([64]);
});
