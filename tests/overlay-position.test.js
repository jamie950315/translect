import { describe, expect, test, vi } from "vitest";

import { scheduleOverlayPositionRefresh } from "../src/content/overlay-position.js";

describe("overlay position scheduling", () => {
  test("does no work when there are no overlays", () => {
    const requestFrame = vi.fn();
    scheduleOverlayPositionRefresh(new Set(), requestFrame);
    expect(requestFrame).not.toHaveBeenCalled();
  });

  test("coalesces a scroll burst and skips unchanged style writes", () => {
    const writes = vi.fn();
    const style = new Proxy({}, { set(target, key, value) {
      writes(key, value);
      target[key] = value;
      return true;
    } });
    let x = 10;
    const getRect = vi.fn(() => ({ x, y: 20, width: 200, height: 100 }));
    const entries = new Set([{ node: { style }, getRect }]);
    const frames = [];
    for (let index = 0; index < 20; index += 1) {
      scheduleOverlayPositionRefresh(entries, (callback) => frames.push(callback));
    }
    expect(frames).toHaveLength(1);
    expect(getRect).toHaveBeenCalledTimes(1);
    x = 50;
    frames.shift()();
    expect(getRect).toHaveBeenCalledTimes(2);
    expect(style.left).toBe("50px");
    expect(writes).toHaveBeenCalledTimes(6);
  });

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
