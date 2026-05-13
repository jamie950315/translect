import { describe, expect, test } from "vitest";

import {
  dedupeImageElementsByVisualRect,
  isAutoTranslateCandidate
} from "../src/content/image-candidate.js";

describe("auto translate image targeting", () => {
  test("keeps medium-to-large content images in auto mode", () => {
    expect(
      isAutoTranslateCandidate({
        naturalHeight: 512,
        naturalWidth: 512,
        rect: {
          height: 172,
          width: 240,
          x: 40,
          y: 60
        },
        viewport: {
          height: 900,
          width: 1200
        }
      })
    ).toBe(true);
  });

  test("skips tiny thumbnails and avatars in auto mode", () => {
    expect(
      isAutoTranslateCandidate({
        naturalHeight: 144,
        naturalWidth: 144,
        rect: {
          height: 144,
          width: 144,
          x: 20,
          y: 20
        },
        viewport: {
          height: 900,
          width: 1200
        }
      })
    ).toBe(false);

    expect(
      isAutoTranslateCandidate({
        naturalHeight: 82,
        naturalWidth: 82,
        rect: {
          height: 82,
          width: 82,
          x: 20,
          y: 20
        },
        viewport: {
          height: 900,
          width: 1200
        }
      })
    ).toBe(false);
  });

  test("skips partially clipped images in auto mode", () => {
    expect(
      isAutoTranslateCandidate({
        naturalHeight: 1200,
        naturalWidth: 800,
        rect: {
          height: 347,
          width: 782,
          x: 0,
          y: -40
        },
        viewport: {
          height: 900,
          width: 1200
        }
      })
    ).toBe(false);
  });
});

describe("visual image candidate dedupe", () => {
  test("keeps one image when Reddit exposes duplicate image elements at the same position", () => {
    const primary = {
      getBoundingClientRect: () => ({
        height: 260,
        width: 560,
        x: 40,
        y: 80
      }),
      naturalHeight: 720,
      naturalWidth: 1280
    };
    const duplicate = {
      getBoundingClientRect: () => ({
        height: 258,
        width: 558,
        x: 41,
        y: 81
      }),
      naturalHeight: 720,
      naturalWidth: 1280
    };

    expect(dedupeImageElementsByVisualRect([primary, duplicate])).toEqual([primary]);
  });

  test("keeps separate images that do not overlap visually", () => {
    const first = {
      getBoundingClientRect: () => ({
        height: 260,
        width: 560,
        x: 40,
        y: 80
      })
    };
    const second = {
      getBoundingClientRect: () => ({
        height: 260,
        width: 560,
        x: 40,
        y: 380
      })
    };

    expect(dedupeImageElementsByVisualRect([first, second])).toEqual([first, second]);
  });
});
