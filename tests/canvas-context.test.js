import { describe, expect, test, vi } from "vitest";

import {
  getCanvasContext2d,
  getReadableCanvasContext2d
} from "../src/content/canvas-context.js";

describe("canvas context helpers", () => {
  test("requests willReadFrequently for read-heavy source canvases", () => {
    const expectedContext = {};
    const canvas = {
      getContext: vi.fn().mockReturnValue(expectedContext)
    };

    expect(getReadableCanvasContext2d(canvas)).toBe(expectedContext);
    expect(canvas.getContext).toHaveBeenCalledWith("2d", {
      willReadFrequently: true
    });
  });

  test("throws when a 2d context cannot be acquired", () => {
    const canvas = {
      getContext: vi.fn().mockReturnValue(null)
    };

    expect(() => getCanvasContext2d(canvas)).toThrow(
      "Could not acquire a 2d canvas context."
    );
  });
});
