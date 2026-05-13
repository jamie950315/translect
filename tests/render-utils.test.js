import { describe, expect, test } from "vitest";

import {
  fitFontSize,
  planTextLayouts,
  resolveReadableFontWeight,
  resolveReadableStrokeWidth,
  tokenizeText,
  wrapTextToWidth
} from "../src/shared/render-utils.js";

function measureWidth(text, fontSize) {
  return text.length * fontSize * 0.54;
}

describe("render utils", () => {
  test("wraps spaced text into multiple lines", () => {
    const lines = wrapTextToWidth("hello brave new world", 60, (text) => measureWidth(text, 16));
    expect(lines.length).toBeGreaterThan(1);
  });

  test("wraps CJK text character by character", () => {
    const lines = wrapTextToWidth("這是一段需要換行的文字", 40, (text) => measureWidth(text, 16));
    expect(lines.length).toBeGreaterThan(1);
  });

  test("wraps mixed CJK text with spaces without shrinking it into one long token", () => {
    const text = "50 公尺的距離，開車比走路更麻煩。你會為很短的路程啟動引擎、移車、找空位。";
    const lines = wrapTextToWidth(text, 160, (value) => measureWidth(value, 16));

    expect(tokenizeText(text).length).toBeGreaterThan(20);
    expect(lines.length).toBeGreaterThan(2);
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThan(text.length / 2);
  });

  test("softens CJK font weight and stroke for readability", () => {
    expect(resolveReadableFontWeight(800, "我們不在乎", "plain-text")).toBe(560);
    expect(resolveReadableFontWeight(800, "WE DON'T CARE", "plain-text")).toBe(800);
    expect(resolveReadableStrokeWidth(6, "我們不在乎", 28, "image-text")).toBe(2);
    expect(resolveReadableStrokeWidth(6, "我們不在乎", 28, "plain-text")).toBe(1);
  });

  test("fits font size inside a box", () => {
    const result = fitFontSize("translated text fits", { width: 180, height: 80 }, { measureWidth });
    expect(result.fontSize).toBeGreaterThanOrEqual(10);
    expect(result.lines.length).toBeGreaterThan(0);
  });

  test("keeps stacked blocks in the same chat response at a consistent font size", () => {
    const layouts = planTextLayouts(
      [
        {
          bounds: { x: 40, y: 40, width: 320, height: 92 },
          style: { align: "left", fontWeight: 700, rotation: 0 },
          translatedText: "第一段回覆被拆成上半部。"
        },
        {
          bounds: { x: 42, y: 136, width: 318, height: 62 },
          style: { align: "left", fontWeight: 700, rotation: 0 },
          translatedText: "同一段回覆被拆成下半部，但字級不該變小。"
        }
      ],
      { measureWidth }
    );

    expect(layouts).toHaveLength(2);
    expect(layouts[0].fontSize).toBe(layouts[1].fontSize);
  });

  test("does not force separate title and body blocks into the same font size", () => {
    const layouts = planTextLayouts(
      [
        {
          bounds: { x: 140, y: 30, width: 140, height: 30 },
          style: { align: "center", fontWeight: 700, rotation: 0 },
          translatedText: "已儲存的記憶"
        },
        {
          bounds: { x: 40, y: 92, width: 340, height: 110 },
          style: { align: "left", fontWeight: 700, rotation: 0 },
          translatedText: "不希望回覆中出現隨機的粗體字，因為這讓他們感到困擾。"
        }
      ],
      { measureWidth }
    );

    expect(layouts).toHaveLength(2);
    expect(layouts[0].fontSize).not.toBe(layouts[1].fontSize);
  });

  test("shares typography across separated blocks when the model marks the same group", () => {
    const layouts = planTextLayouts(
      [
        {
          bounds: { x: 210, y: 54, width: 220, height: 82 },
          groupId: "chat-right",
          sourceLineCount: 2,
          style: {
            align: "left",
            backgroundColor: "#2d68ea",
            container: "speech-bubble",
            fontWeight: 700,
            rotation: 0,
            textColor: "#ffffff"
          },
          translatedText: "嘿兄弟，最近怎樣"
        },
        {
          bounds: { x: 120, y: 168, width: 240, height: 90 },
          sourceLineCount: 3,
          style: {
            align: "left",
            backgroundColor: "#f3efe8",
            container: "ui-card",
            fontWeight: 700,
            rotation: 0,
            textColor: "#111111"
          },
          translatedText: "這張嵌入卡片應該用自己的字級。"
        },
        {
          bounds: { x: 228, y: 302, width: 218, height: 84 },
          groupId: "chat-right",
          sourceLineCount: 2,
          style: {
            align: "left",
            backgroundColor: "#2d68ea",
            container: "speech-bubble",
            fontWeight: 700,
            rotation: 0,
            textColor: "#ffffff"
          },
          translatedText: "你要來嗎？"
        }
      ],
      { measureWidth }
    );

    expect(layouts).toHaveLength(3);
    expect(layouts[0].fontSize).toBe(layouts[2].fontSize);
    expect(layouts[1].fontSize).not.toBe(layouts[0].fontSize);
  });

  test("prefers the original line count instead of over-enlarging short translated text", () => {
    const unconstrained = fitFontSize("Thanks friend", { width: 140, height: 54 }, {
      maxFontSize: 32,
      measureWidth
    });
    const constrained = fitFontSize("Thanks friend", { width: 140, height: 54 }, {
      maxFontSize: 32,
      measureWidth,
      targetLineCount: 1
    });

    expect(unconstrained.lines).toHaveLength(2);
    expect(constrained.lines).toHaveLength(1);
    expect(constrained.fontSize).toBeLessThan(unconstrained.fontSize);
  });

  test("keeps CJK translations close to the source UI text size", () => {
    const layouts = planTextLayouts(
      [
        {
          bounds: { x: 250, y: 525, width: 590, height: 138 },
          sourceLineCount: 4,
          style: {
            align: "left",
            container: "plain-text",
            fontWeight: 500,
            rotation: 0
          },
          translatedText: "英國法律要求您確認年齡，並設定內容限制。"
        }
      ],
      { measureWidth }
    );

    expect(layouts[0].fontSize).toBeLessThanOrEqual(26);
  });
});
