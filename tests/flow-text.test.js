import { describe, expect, test } from "vitest";

import {
  distributeTextAcrossBoxes,
  distributeTextAcrossLineBlocks
} from "../src/shared/flow-text.js";

describe("flow text distribution", () => {
  test("does not let a narrow OCR box consume text meant for later boxes", () => {
    const assignments = distributeTextAcrossBoxes(
      "Yo Chris bought an iPhone",
      [{ width: 8 }, { width: 60 }],
      {
        measureWidth(value) {
          return value.length;
        }
      }
    );

    expect(assignments).toEqual(["Yo Chris", "bought an iPhone"]);
  });

  test("keeps translated CJK text inside each available OCR line width", () => {
    const assignments = distributeTextAcrossBoxes(
      "我買了一支二手iPhone17Pro為什麼你的電話號碼一直同步",
      [{ width: 16 }, { width: 16 }, { width: 80 }],
      {
        measureWidth(value) {
          return Array.from(value).length;
        }
      }
    );

    expect(assignments[0].length).toBeLessThanOrEqual(16);
    expect(assignments[1].length).toBeLessThanOrEqual(16);
    expect(assignments.join("")).toContain("電話號碼");
  });

  test("redistributes CJK text across model-split image text lines", () => {
    const assignments = distributeTextAcrossLineBlocks(
      [
        { text: "不，筆電", width: 11 },
        { text: "充電器不應該", width: 14 },
        { text: "應該通用", width: 10 }
      ],
      {
        measureWidth(value) {
          return Array.from(value).length;
        }
      }
    );

    expect(assignments[0]).not.toBe("不，筆電");
    expect(assignments[0]).toContain("充電");
    expect(assignments.join("")).toBe("不，筆電充電器不應該應該通用");
  });
});
