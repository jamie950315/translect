import { describe, expect, test } from "vitest";

import {
  canUseDirectImageSource,
  imageSourceUrl
} from "../src/content/image-source.js";

describe("direct image source selection", () => {
  test("uses an original image when the rendered image keeps its natural aspect ratio", () => {
    const image = {
      currentSrc: "https://i.redd.it/example.png",
      getBoundingClientRect: () => ({
        height: 360,
        width: 640
      }),
      naturalHeight: 720,
      naturalWidth: 1280
    };

    expect(canUseDirectImageSource(image)).toBe(true);
    expect(imageSourceUrl(image)).toBe("https://i.redd.it/example.png");
  });

  test("falls back to screenshot capture when the rendered image is cropped or distorted", () => {
    const image = {
      currentSrc: "https://i.redd.it/cropped.png",
      getBoundingClientRect: () => ({
        height: 320,
        width: 320
      }),
      naturalHeight: 720,
      naturalWidth: 1280
    };

    expect(canUseDirectImageSource(image)).toBe(false);
  });

  test("does not use empty or inline blob sources as background-fetchable images", () => {
    expect(imageSourceUrl({ currentSrc: "blob:https://example.test/id", src: "" })).toBe("");
    expect(imageSourceUrl({ currentSrc: "", src: "" })).toBe("");
  });
});
