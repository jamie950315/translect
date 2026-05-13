import { describe, expect, test } from "vitest";

import {
  analyzeRegionTextureFromImageData,
  classifyTextSurface,
  chooseCoverMode,
  detectTextInkBoundsFromImageData,
  resolveCoverGeometry,
  resolveSolidCoverPadding,
  resolveRenderedContainerKind,
  resolveTextAreaBackgroundColor,
  resolveTextVerticalAlign,
  resolveCoverOpacity,
  sampleBackgroundColorFromImageData,
  sampleRectEdgeColorFromImageData
} from "../src/content/text-cover.js";

function createImageData(width, height, backgroundRgb, centerRgb) {
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const isCenter = x >= 2 && x <= 5 && y >= 2 && y <= 5;
      const [r, g, b] = isCenter ? centerRgb : backgroundRgb;
      pixels[index] = r;
      pixels[index + 1] = g;
      pixels[index + 2] = b;
      pixels[index + 3] = 255;
    }
  }

  return pixels;
}

describe("text cover helpers", () => {
  test("samples the surrounding background instead of averaging in the text color", () => {
    const imageData = createImageData(8, 8, [240, 236, 232], [18, 18, 18]);

    const result = sampleBackgroundColorFromImageData(imageData, 8, 8, {
      x: 2,
      y: 2,
      width: 4,
      height: 4
    });

    expect(result).toBe("#f0ece8");
  });

  test("samples fractional canvas dimensions without falling back to invalid black", () => {
    const imageData = createImageData(8, 8, [248, 248, 246], [18, 18, 18]);

    const result = sampleBackgroundColorFromImageData(imageData, 8.6, 8.2, {
      x: 2.3,
      y: 2.2,
      width: 4.1,
      height: 4.4
    });

    expect(result).toMatch(/^#[0-9a-f]{6}$/);
    expect(result).not.toBe("#000000");
  });

  test("raises weak cover opacity so original text is less likely to bleed through", () => {
    expect(resolveCoverOpacity(0.72)).toBe(0.965);
    expect(resolveCoverOpacity(0.99)).toBe(0.99);
  });

  test("classifies flat screenshot-like regions as ui mode", () => {
    const imageData = createImageData(8, 8, [240, 236, 232], [18, 18, 18]);
    const analysis = analyzeRegionTextureFromImageData(imageData, 8, 8, {
      x: 2,
      y: 2,
      width: 4,
      height: 4
    });

    expect(chooseCoverMode(analysis)).toBe("ui");
  });

  test("classifies noisy textured regions as image mode", () => {
    const imageData = new Uint8ClampedArray(8 * 8 * 4);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const index = (y * 8 + x) * 4;
        imageData[index] = (x * 41 + y * 17) % 255;
        imageData[index + 1] = (x * 13 + y * 53) % 255;
        imageData[index + 2] = (x * 71 + y * 29) % 255;
        imageData[index + 3] = 255;
      }
    }

    const analysis = analyzeRegionTextureFromImageData(imageData, 8, 8, {
      x: 2,
      y: 2,
      width: 4,
      height: 4
    });

    expect(chooseCoverMode(analysis)).toBe("image");
  });

  test("treats moderately varied dark app screenshots as ui mode", () => {
    expect(
      chooseCoverMode({
        dominantColorShare: 0.2,
        luminanceVariance: 0.018,
        quantizedColorCount: 12,
        sampleCount: 120
      })
    ).toBe("ui");
  });

  test("uses compact padding for solid ui covers so nearby blocks do not collide", () => {
    expect(resolveSolidCoverPadding({ width: 120, height: 40 })).toEqual({
      horizontal: 6,
      vertical: 5
    });
  });

  test("treats text on a flat page background as plain text instead of a contained card", () => {
    const imageData = createImageData(12, 12, [248, 245, 239], [248, 245, 239]);

    const result = classifyTextSurface(
      {
        backgroundColor: "#f8f5ef",
        dominantColorShare: 0.61,
        luminanceVariance: 0.004,
        quantizedColorCount: 3,
        sampleCount: 120
      },
      {
        backgroundColor: "#f7f4ee",
        dominantColorShare: 0.56,
        luminanceVariance: 0.006,
        quantizedColorCount: 4,
        sampleCount: 60
      },
      { width: 240, height: 72 }
    );

    expect(result).toBe("plain-text");
    expect(resolveTextVerticalAlign(result, "auto")).toBe("top");
    expect(resolveCoverGeometry({ width: 240, height: 72 }, result)).toMatchObject({
      radius: 2
    });
  });

  test("classifies a dark wide overlay as a caption strip", () => {
    const result = classifyTextSurface(
      {
        backgroundColor: "#0d0d0d",
        dominantColorShare: 0.72,
        luminanceVariance: 0.003,
        quantizedColorCount: 2,
        sampleCount: 160
      },
      {
        backgroundColor: "#4b5c89",
        dominantColorShare: 0.18,
        luminanceVariance: 0.08,
        quantizedColorCount: 18,
        sampleCount: 140
      },
      { width: 480, height: 88 }
    );

    expect(result).toBe("caption-strip");
    expect(resolveTextVerticalAlign(result, "auto")).toBe("middle");
    expect(resolveCoverGeometry({ width: 480, height: 88 }, result).radius).toBe(5);
  });

  test("keeps heavy meme text on a flat background as plain text", () => {
    const result = classifyTextSurface(
      {
        backgroundColor: "#d8d8d8",
        dominantColorShare: 0.12,
        luminanceVariance: 0.12,
        quantizedColorCount: 22,
        sampleCount: 180
      },
      {
        backgroundColor: "#ffffff",
        dominantColorShare: 0.82,
        luminanceVariance: 0.002,
        quantizedColorCount: 2,
        sampleCount: 160
      },
      { width: 360, height: 130 }
    );

    expect(result).toBe("plain-text");
  });

  test("uses the surrounding color for plain text instead of averaging dark glyph pixels", () => {
    expect(resolveTextAreaBackgroundColor("plain-text", "#171717", "#f7f7f4")).toBe("#f7f7f4");
    expect(resolveTextAreaBackgroundColor("image-text", "#6b533e", "#d9d8d5")).toBe("#d9d8d5");
    expect(resolveTextAreaBackgroundColor("speech-bubble", "#404040", "#505050")).toBe("#404040");
  });

  test("prefers a light surrounding page color over a dark glyph-heavy text sample", () => {
    expect(resolveTextAreaBackgroundColor("caption-strip", "#111111", "#fbfbf8")).toBe("#fbfbf8");
  });

  test("samples text box edges so black glyphs on white pages do not become black covers", () => {
    const pixels = createImageData(10, 10, [248, 248, 246], [16, 16, 16]);

    for (let y = 2; y <= 5; y += 1) {
      for (let x = 2; x <= 5; x += 1) {
        const index = (y * 10 + x) * 4;
        const isGlyph = x >= 3 && x <= 4 && y >= 3 && y <= 4;
        const color = isGlyph ? [16, 16, 16] : [248, 248, 246];
        pixels[index] = color[0];
        pixels[index + 1] = color[1];
        pixels[index + 2] = color[2];
      }
    }

    expect(
      sampleRectEdgeColorFromImageData(pixels, 10, 10, {
        x: 2,
        y: 2,
        width: 4,
        height: 4
      })
    ).toBe("#f8f8f6");
  });

  test("detects a tight ink box inside an oversized model rectangle", () => {
    const pixels = new Uint8ClampedArray(24 * 16 * 4);
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 24; x += 1) {
        const index = (y * 24 + x) * 4;
        pixels[index] = 250;
        pixels[index + 1] = 250;
        pixels[index + 2] = 248;
        pixels[index + 3] = 255;
      }
    }
    for (let y = 6; y <= 9; y += 1) {
      for (let x = 8; x <= 15; x += 1) {
        const index = (y * 24 + x) * 4;
        pixels[index] = 20;
        pixels[index + 1] = 20;
        pixels[index + 2] = 20;
      }
    }

    const result = detectTextInkBoundsFromImageData(pixels, 24, 16, {
      x: 2,
      y: 2,
      width: 20,
      height: 12
    });

    expect(result).toEqual({
      x: 8,
      y: 6,
      width: 8,
      height: 4
    });
  });

  test("does not let a model-provided card override a locally detected flat text surface", () => {
    expect(resolveRenderedContainerKind("speech-bubble", "plain-text")).toBe("plain-text");
    expect(resolveRenderedContainerKind("caption-strip", "plain-text")).toBe("plain-text");
    expect(resolveRenderedContainerKind("caption-strip", "image-text")).toBe("caption-strip");
  });
});
