import { describe, expect, test } from "vitest";

import {
  rectCoverageRatio,
  shouldReplaceOverlayRect
} from "../src/content/overlay-dedupe.js";

describe("overlay dedupe helpers", () => {
  test("detects overlays that cover the same visual image area", () => {
    const existing = {
      height: 400,
      width: 800,
      x: 100,
      y: 50
    };
    const incoming = {
      height: 398,
      width: 796,
      x: 102,
      y: 52
    };

    expect(rectCoverageRatio(existing, incoming)).toBeGreaterThan(0.98);
    expect(shouldReplaceOverlayRect(existing, incoming)).toBe(true);
  });

  test("keeps distinct nearby overlays", () => {
    expect(
      shouldReplaceOverlayRect(
        {
          height: 320,
          width: 500,
          x: 100,
          y: 80
        },
        {
          height: 320,
          width: 500,
          x: 650,
          y: 80
        }
      )
    ).toBe(false);
  });
});
