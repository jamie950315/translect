import { describe, expect, test } from "vitest";

import {
  buildTextTranslationPayload,
  mergeOcrAndTranslationResults,
  normalizeIosOcrResult
} from "../src/shared/ios-ocr.js";

describe("iOS OCR helpers", () => {
  const ocrJson = {
    success: true,
    image_width: 200,
    image_height: 100,
    ocr_boxes: [
      {
        text: "Hello",
        x: 20,
        y: 10,
        w: 80,
        h: 20,
        rect: {
          topLeft_x: 20,
          topLeft_y: 10,
          topRight_x: 100,
          topRight_y: 10,
          bottomRight_x: 100,
          bottomRight_y: 30,
          bottomLeft_x: 20,
          bottomLeft_y: 30
        }
      }
    ]
  };

  test("normalizes pixel OCR boxes into translect coordinate blocks", () => {
    const result = normalizeIosOcrResult("image-a", ocrJson);

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      id: "image-a:0",
      sourceText: "Hello",
      bounds: {
        x: 100,
        y: 100,
        width: 400,
        height: 200,
        rotation: 0
      }
    });
  });

  test("builds one text-only translation payload for multiple OCR images", () => {
    const payload = buildTextTranslationPayload({
      model: "gpt-5.4-mini",
      ocrImages: [
        normalizeIosOcrResult("image-a", ocrJson),
        normalizeIosOcrResult("image-b", {
          ...ocrJson,
          ocr_boxes: [{ ...ocrJson.ocr_boxes[0], text: "World" }]
        })
      ],
      targetLanguage: "Traditional Chinese"
    });

    expect(payload.model).toBe("gpt-5.4-mini");
    expect(payload.messages[0].content).toContain("Do not perform OCR");
    expect(payload.messages[1].content).toContain("\"image_id\":\"image-a\"");
    expect(payload.messages[1].content).toContain("\"image_id\":\"image-b\"");
    expect(payload.messages[1].content).toContain("\"text\":\"World\"");
  });

  test("merges translated text onto OCR-owned boxes", () => {
    const merged = mergeOcrAndTranslationResults(
      [normalizeIosOcrResult("image-a", ocrJson)],
      {
        images: [
          {
            image_id: "image-a",
            blocks: [
              {
                box_id: "image-a:0",
                translated_text: "你好"
              }
            ]
          }
        ]
      }
    );

    expect(merged).toEqual([
      {
        imageId: "image-a",
        translation: {
          blocks: [
            expect.objectContaining({
              sourceText: "Hello",
              translatedText: "你好",
              bounds: {
                x: 100,
                y: 100,
                width: 400,
                height: 200,
                rotation: 0
              }
            })
          ]
        }
      }
    ]);
  });

  test("groups nearby OCR lines into one translation block", () => {
    const result = normalizeIosOcrResult("image-a", {
      success: true,
      image_width: 1000,
      image_height: 600,
      ocr_boxes: [
        { text: "Google Chrome is", x: 100, y: 100, w: 420, h: 48 },
        { text: "downloading an AI model", x: 102, y: 154, w: 510, h: 48 },
        { text: "BY AJ DELLINGER", x: 100, y: 420, w: 250, h: 34 }
      ]
    });

    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]).toMatchObject({
      sourceLineCount: 2,
      sourceText: "Google Chrome is\ndownloading an AI model"
    });
    expect(result.blocks[0].bounds.x).toBe(100);
    expect(result.blocks[0].bounds.y).toBeCloseTo(166.6666, 3);
    expect(result.blocks[0].bounds.width).toBe(512);
    expect(result.blocks[0].bounds.height).toBe(170);
  });

  test("drops tiny chart ticks and mostly numeric labels", () => {
    const result = normalizeIosOcrResult("image-a", {
      success: true,
      image_width: 1000,
      image_height: 600,
      ocr_boxes: [
        { text: "0", x: 100, y: 500, w: 10, h: 14 },
        { text: "5-31", x: 850, y: 500, w: 34, h: 14 },
        { text: "Monthly expenses", x: 120, y: 120, w: 260, h: 34 }
      ]
    });

    expect(result.blocks.map((block) => block.sourceText)).toEqual([
      "Monthly expenses"
    ]);
  });
});
