import { describe, expect, test } from "vitest";

import { scheduleOverlayPositionRefresh } from "../src/content/overlay-position.js";

describe("overlay position scheduling", () => {
  test("positions an overlay before Safari runs the next animation frame", () => {
    const node = { style: {} };
    const queuedFrames = [];

    scheduleOverlayPositionRefresh(
      new Set([
        {
          getRect: () => ({ height: 535, width: 951, x: 30, y: 208 }),
          node
        }
      ]),
      (callback) => queuedFrames.push(callback)
    );

    expect(node.style).toMatchObject({
      display: "block",
      height: "535px",
      left: "30px",
      top: "208px",
      width: "951px"
    });
    expect(queuedFrames).toHaveLength(1);
  });
});
