import { describe, expect, test } from "vitest";

import {
  buildMacosVisionTextTranslationPayload,
  mergeMacosVisionTranslationResults,
  normalizeAppleIntelligenceResult,
  normalizeMacosVisionOcrResult
} from "../src/shared/macos-vision-ocr.js";
import {
  distributeTextAcrossBoxes,
  resolveSharedFlowWidths
} from "../src/shared/flow-text.js";

describe("macOS Vision OCR helpers", () => {
  const nativeResponse = {
    ok: true,
    image_width: 400,
    image_height: 200,
    observations: [
      {
        text: "Hello",
        confidence: 0.98,
        x: 40,
        y: 20,
        width: 120,
        height: 30
      },
      {
        text: "World",
        confidence: 0.93,
        bounding_box: {
          x: 42,
          y: 58,
          width: 128,
          height: 30
        }
      }
    ]
  };

  test("keeps each native Vision observation as a separate translect OCR block", () => {
    const result = normalizeMacosVisionOcrResult("image-a", nativeResponse);

    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]).toMatchObject({
      id: "image-a:0",
      flowGroupId: "image-a:flow:0",
      flowBoxIndex: 0,
      provider: "macos-vision",
      sourceLineCount: 1,
      sourceText: "Hello",
      style: {
        align: "left"
      },
      bounds: {
        x: 100,
        y: 100,
        width: 300,
        height: 150,
        rotation: 0
      }
    });
    expect(result.blocks[1]).toMatchObject({
      id: "image-a:1",
      flowGroupId: "image-a:flow:0",
      flowBoxIndex: 1,
      provider: "macos-vision",
      sourceLineCount: 1,
      sourceText: "World",
      bounds: {
        x: 105,
        y: 290,
        width: 320,
        height: 150,
        rotation: 0
      }
    });
  });

  test("keeps closely stacked tweet metadata, controls, and body in separate flow groups", () => {
    const result = normalizeMacosVisionOcrResult("tweet", {
      ok: true,
      image_width: 590,
      image_height: 295,
      observations: [
        { text: "@thsottiaux · 6min", x: 119, y: 16, width: 142, height: 13 },
        { text: "Mostrar traducción", x: 60, y: 40, width: 112, height: 11 },
        {
          text: "We kept ourselves busy with GPT-5.6 Sol.",
          x: 60,
          y: 62,
          width: 360,
          height: 15
        }
      ]
    });

    expect(result.blocks.map((block) => block.flowGroupId)).toEqual([
      "tweet:flow:0",
      "tweet:flow:1",
      "tweet:flow:2"
    ]);
  });

  test("translates grouped text while preserving separate line boxes for rendering", () => {
    const ocrImage = normalizeMacosVisionOcrResult("image-a", nativeResponse);
    const payload = buildMacosVisionTextTranslationPayload({
      model: "gpt-5.4-mini",
      ocrImages: [ocrImage],
      targetLanguage: "Traditional Chinese"
    });

    expect(payload.messages[1].content).toContain("\"image_id\":\"image-a\"");
    expect(payload.messages[1].content).toContain("\"group_id\":\"image-a:flow:0\"");
    expect(payload.messages[1].content).toContain("\"text\":\"Hello\\nWorld\"");
    expect(payload.messages[1].content).toContain("\"box_ids\":[\"image-a:0\",\"image-a:1\"]");

    const merged = mergeMacosVisionTranslationResults([ocrImage], {
      images: [
        {
          image_id: "image-a",
          groups: [
            {
              group_id: "image-a:flow:0",
              translated_text: "你好世界"
            }
          ]
        }
      ]
    });

    expect(merged[0].translation.blocks[0]).toMatchObject({
      provider: "macos-vision",
      flowGroupId: "image-a:flow:0",
      flowText: "你好世界",
      translatedText: ""
    });
    expect(merged[0].translation.blocks[1]).toMatchObject({
      provider: "macos-vision",
      flowGroupId: "image-a:flow:0",
      flowText: "你好世界",
      translatedText: ""
    });
  });

  test("omits custom temperature for GPT-5.6 Terra macOS Vision text translations", () => {
    const payload = buildMacosVisionTextTranslationPayload({
      model: "gpt-5.6-terra",
      ocrImages: [],
      targetLanguage: "Traditional Chinese"
    });

    expect(payload).not.toHaveProperty("temperature");
  });

  test("normalizes local Apple Intelligence translations without a remote API response", () => {
    const result = normalizeAppleIntelligenceResult("image-a", {
      ...nativeResponse,
      observations: nativeResponse.observations.map((observation, index) => ({
        ...observation,
        flow_box_index: index,
        flow_group_id: "image-a:flow:0",
        semantic_label: "body",
        translated_text: "你好世界"
      }))
    });

    expect(result.translation.blocks).toHaveLength(2);
    expect(result.translation.blocks[0]).toMatchObject({
      provider: "macos-vision",
      flowBoxIndex: 0,
      flowGroupId: "image-a:flow:0",
      flowText: "你好世界",
      semanticLabel: "body",
      sourceText: "Hello",
      translatedText: ""
    });
    expect(result.translation.blocks[1]).toMatchObject({
      flowBoxIndex: 1,
      flowText: "你好世界",
      sourceText: "World"
    });
  });

  test("distributes translated text across line boxes and leaves unused boxes empty", () => {
    const boxes = [
      { id: "box-0", width: 24 },
      { id: "box-1", width: 24 },
      { id: "box-2", width: 24 }
    ];
    const assigned = distributeTextAcrossBoxes("你好", boxes, {
      measureWidth: (value) => Array.from(value).length * 10
    });

    expect(assigned).toEqual(["你好", "", ""]);
  });

  test("continues overflowing translated text into the next native line box", () => {
    const boxes = [
      { id: "box-0", width: 25 },
      { id: "box-1", width: 40 }
    ];
    const assigned = distributeTextAcrossBoxes("very long text", boxes, {
      measureWidth: (value) => value.length * 4
    });

    expect(assigned).toEqual(["very", "long text"]);
  });

  test("keeps latin product names together while filling CJK text before them", () => {
    const boxes = [
      { id: "box-0", width: 72 },
      { id: "box-1", width: 72 }
    ];
    const assigned = distributeTextAcrossBoxes("我買了一支二手iPhone17Pro", boxes, {
      measureWidth: (value) => Array.from(value).length * 9
    });

    expect(assigned[0]).toBe("我買了一支二手");
    expect(assigned[1]).toContain("iPhone17Pro");
  });

  test("does not assign text beyond the real width of a macOS Vision line box", () => {
    const boxes = [
      { id: "box-0", width: 72 },
      { id: "box-1", width: 120 }
    ];
    const flowWidths = resolveSharedFlowWidths(boxes);
    const assigned = distributeTextAcrossBoxes("為什麼你的電話號碼一直和我同步", boxes, {
      resolveWidth: (_box, index) => flowWidths[index],
      measureWidth: (value) => Array.from(value).length * 10
    });

    expect(assigned).toEqual(["為什麼你的電話", "號碼一直和我同步"]);
    expect(assigned.every((value, index) => Array.from(value).length * 10 <= boxes[index].width)).toBe(true);
  });

  test("preserves CJK flow while respecting each macOS Vision line width", () => {
    const boxes = [
      { id: "box-0", width: 4 },
      { id: "box-1", width: 8 },
      { id: "box-2", width: 6 }
    ];
    const flowWidths = resolveSharedFlowWidths(boxes);
    const assigned = distributeTextAcrossBoxes("不，筆電充電器不應該應該通用", boxes, {
      resolveWidth: (_box, index) => flowWidths[index],
      measureWidth: (value) => Array.from(value).length
    });

    expect(assigned[0]).toBe("不，筆電");
    expect(assigned.join("")).toBe("不，筆電充電器不應該應該通用");
  });
});
