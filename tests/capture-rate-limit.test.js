import { describe, expect, test } from "vitest";

import { createCaptureVisibleTabLimiter } from "../src/background/capture-rate-limit.js";

describe("capture visible tab limiter", () => {
  test("serializes rapid capture requests so calls stay under the quota window", async () => {
    let currentTime = 10_000;
    const invocationTimes = [];

    const limiter = createCaptureVisibleTabLimiter({
      minIntervalMs: 1_100,
      now() {
        return currentTime;
      },
      sleep(ms) {
        currentTime += ms;
        return Promise.resolve();
      }
    });

    const first = limiter(async () => {
      invocationTimes.push(currentTime);
      return "first";
    });
    const second = limiter(async () => {
      invocationTimes.push(currentTime);
      return "second";
    });
    const third = limiter(async () => {
      invocationTimes.push(currentTime);
      return "third";
    });

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      "first",
      "second",
      "third"
    ]);
    expect(invocationTimes).toEqual([10_000, 11_100, 12_200]);
  });

  test("allows the next capture immediately once the cooldown window has passed", async () => {
    let currentTime = 5_000;
    const invocationTimes = [];

    const limiter = createCaptureVisibleTabLimiter({
      minIntervalMs: 1_100,
      now() {
        return currentTime;
      },
      sleep(ms) {
        currentTime += ms;
        return Promise.resolve();
      }
    });

    await limiter(async () => {
      invocationTimes.push(currentTime);
    });

    currentTime += 2_000;

    await limiter(async () => {
      invocationTimes.push(currentTime);
    });

    expect(invocationTimes).toEqual([5_000, 7_000]);
  });
});
