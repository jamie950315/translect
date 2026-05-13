import { describe, expect, test } from "vitest";

import { configureOverlayCanvas } from "../src/content/overlay-canvas.js";

describe("configureOverlayCanvas", () => {
  test("forces the rendered canvas to match the overlay box size", () => {
    const canvas = {
      style: {}
    };

    configureOverlayCanvas(canvas);

    expect(canvas.style.width).toBe("100%");
    expect(canvas.style.height).toBe("100%");
    expect(canvas.style.display).toBe("block");
  });
});
