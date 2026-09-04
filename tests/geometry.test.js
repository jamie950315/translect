import { describe, expect, test } from "vitest";

import { orientProviderTextRect } from "../src/shared/geometry.js";

describe("provider OCR text geometry", () => {
  test("turns a vertical OCR footprint into a horizontal local layout box", () => {
    expect(
      orientProviderTextRect({
        x: 104.8,
        y: 283.8,
        width: 23.3,
        height: 194.4,
        rotation: -90
      })
    ).toEqual({
      x: 19.25,
      y: 369.35,
      width: 194.4,
      height: 23.3,
      rotation: -90
    });
  });

  test("does not change a horizontal OCR layout box", () => {
    const rect = { x: 20, y: 30, width: 180, height: 24, rotation: 0 };
    expect(orientProviderTextRect(rect)).toEqual(rect);
  });

  test("supports clockwise vertical text without changing its center", () => {
    const rect = { x: 50, y: 100, width: 20, height: 160, rotation: 90 };
    const oriented = orientProviderTextRect(rect);

    expect(oriented).toMatchObject({ width: 160, height: 20, rotation: 90 });
    expect(oriented.x + oriented.width / 2).toBe(rect.x + rect.width / 2);
    expect(oriented.y + oriented.height / 2).toBe(rect.y + rect.height / 2);
  });
});
