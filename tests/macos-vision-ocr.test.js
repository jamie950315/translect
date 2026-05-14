import { describe, expect, test } from "vitest";

import {
  buildMacosVisionTextTranslationPayload,
  mergeMacosVisionTranslationResults,
  normalizeMacosVisionOcrResult
} from "../src/shared/macos-vision-ocr.js";
import { distributeTextAcrossBoxes } from "../src/shared/flow-text.js";

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

  test("can use a wider shared group width for narrow macOS Vision line boxes", () => {
    const boxes = [
      { id: "box-0", width: 72 },
      { id: "box-1", width: 72, flowWidth: 120 }
    ];
    const assigned = distributeTextAcrossBoxes("為什麼你的電話號碼一直和我同步", boxes, {
      resolveWidth: (box) => box.flowWidth || box.width,
      measureWidth: (value) => Array.from(value).length * 10
    });

    expect(assigned[1].length).toBeGreaterThan(7);
  });
});
