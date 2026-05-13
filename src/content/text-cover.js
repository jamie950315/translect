import { clamp } from "../shared/geometry.js";

function toHexChannel(value) {
  const safeValue = Number.isFinite(value) ? clamp(Math.round(value), 0, 255) : 0;
  return safeValue.toString(16).padStart(2, "0");
}

function averageImageData(imageData, width, height, predicate) {
  const sampleWidth = Math.max(0, Math.floor(width));
  const sampleHeight = Math.max(0, Math.floor(height));
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  for (let y = 0; y < sampleHeight; y += 1) {
    for (let x = 0; x < sampleWidth; x += 1) {
      if (!predicate(x, y)) {
        continue;
      }

      const index = (y * sampleWidth + x) * 4;
      red += imageData[index];
      green += imageData[index + 1];
      blue += imageData[index + 2];
      count += 1;
    }
  }

  if (!count) {
    return null;
  }

  return `#${toHexChannel(red / count)}${toHexChannel(green / count)}${toHexChannel(blue / count)}`;
}

function pixelIsInsideRect(x, y, rect) {
  return (
    x >= rect.x &&
    x < rect.x + rect.width &&
    y >= rect.y &&
    y < rect.y + rect.height
  );
}

function relativeLuminance(red, green, blue) {
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

function quantizeChannel(value) {
  return Math.round(value / 24);
}

function normalizeTextureResult(colorBuckets, luminanceTotal, luminanceSquaredTotal, sampleCount) {
  if (!sampleCount) {
    return {
      backgroundColor: null,
      dominantColorShare: 0,
      luminanceVariance: 1,
      quantizedColorCount: 0,
      sampleCount: 0
    };
  }

  const averageLuminance = luminanceTotal / sampleCount;
  const luminanceVariance = Math.max(
    0,
    luminanceSquaredTotal / sampleCount - averageLuminance * averageLuminance
  );
  const dominantColorCount = Math.max(...colorBuckets.values());

  return {
    dominantColorShare: dominantColorCount / sampleCount,
    luminanceVariance,
    quantizedColorCount: colorBuckets.size,
    sampleCount
  };
}

function analyzePixels(imageData, width, height, predicate) {
  const sampleWidth = Math.max(0, Math.floor(width));
  const sampleHeight = Math.max(0, Math.floor(height));
  const colorBuckets = new Map();
  let luminanceTotal = 0;
  let luminanceSquaredTotal = 0;
  let sampleCount = 0;

  for (let y = 0; y < sampleHeight; y += 1) {
    for (let x = 0; x < sampleWidth; x += 1) {
      if (!predicate(x, y)) {
        continue;
      }

      const index = (y * sampleWidth + x) * 4;
      const red = imageData[index];
      const green = imageData[index + 1];
      const blue = imageData[index + 2];
      const luminance = relativeLuminance(red, green, blue);
      const bucketKey = `${quantizeChannel(red)}-${quantizeChannel(green)}-${quantizeChannel(blue)}`;

      colorBuckets.set(bucketKey, (colorBuckets.get(bucketKey) || 0) + 1);
      luminanceTotal += luminance;
      luminanceSquaredTotal += luminance * luminance;
      sampleCount += 1;
    }
  }

  return normalizeTextureResult(colorBuckets, luminanceTotal, luminanceSquaredTotal, sampleCount);
}

function parseHexColor(color) {
  const match = /^#?([0-9a-f]{6})$/i.exec(color || "");
  if (!match) {
    return null;
  }

  const hex = match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16)
  ];
}

function colorDistance(firstColor, secondColor) {
  const first = parseHexColor(firstColor);
  const second = parseHexColor(secondColor);
  if (!first || !second) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.sqrt(
    (first[0] - second[0]) ** 2 +
      (first[1] - second[1]) ** 2 +
      (first[2] - second[2]) ** 2
  );
}

function channelDistance(firstColor, secondColor) {
  const first = parseHexColor(firstColor);
  const second = parseHexColor(secondColor);
  if (!first || !second) {
    return Number.POSITIVE_INFINITY;
  }

  return (
    Math.abs(first[0] - second[0]) +
    Math.abs(first[1] - second[1]) +
    Math.abs(first[2] - second[2])
  ) / 3;
}

function hexLuminance(color) {
  const rgb = parseHexColor(color);
  if (!rgb) {
    return null;
  }

  return relativeLuminance(rgb[0], rgb[1], rgb[2]);
}

export function sampleBackgroundColorFromImageData(imageData, width, height, excludedRect) {
  const ringAverage = averageImageData(imageData, width, height, (x, y) => {
    return !pixelIsInsideRect(x, y, excludedRect);
  });

  if (ringAverage) {
    return ringAverage;
  }

  return averageImageData(imageData, width, height, () => true) || "#f4eee3";
}

export function sampleRectColorFromImageData(imageData, width, height, rect) {
  return averageImageData(imageData, width, height, (x, y) => pixelIsInsideRect(x, y, rect));
}

export function sampleRectEdgeColorFromImageData(imageData, width, height, rect) {
  const insetX = Math.max(1, Math.floor(rect.width * 0.16));
  const insetY = Math.max(1, Math.floor(rect.height * 0.16));
  const edgeAverage = averageImageData(imageData, width, height, (x, y) => {
    if (!pixelIsInsideRect(x, y, rect)) {
      return false;
    }

    return (
      x < rect.x + insetX ||
      x >= rect.x + rect.width - insetX ||
      y < rect.y + insetY ||
      y >= rect.y + rect.height - insetY
    );
  });

  return edgeAverage || sampleRectColorFromImageData(imageData, width, height, rect);
}

export function analyzeRegionTextureFromImageData(imageData, width, height, excludedRect) {
  return analyzePixels(imageData, width, height, (x, y) => !pixelIsInsideRect(x, y, excludedRect));
}

export function analyzeRectTextureFromImageData(imageData, width, height, rect) {
  return analyzePixels(imageData, width, height, (x, y) => pixelIsInsideRect(x, y, rect));
}

export function detectTextInkBoundsFromImageData(imageData, width, height, rect, options = {}) {
  const sampleWidth = Math.max(0, Math.floor(width));
  const sampleHeight = Math.max(0, Math.floor(height));
  const backgroundColor = sampleRectEdgeColorFromImageData(imageData, sampleWidth, sampleHeight, rect);
  const backgroundLuminance = hexLuminance(backgroundColor);
  const expectedTextColor = parseHexColor(options.textColor);
  const minX = Math.max(0, Math.floor(rect.x));
  const minY = Math.max(0, Math.floor(rect.y));
  const maxX = Math.min(sampleWidth, Math.ceil(rect.x + rect.width));
  const maxY = Math.min(sampleHeight, Math.ceil(rect.y + rect.height));
  const rowCounts = new Array(Math.max(0, maxY - minY)).fill(0);
  const colCounts = new Array(Math.max(0, maxX - minX)).fill(0);
  let inkCount = 0;

  if (backgroundLuminance === null || maxX <= minX || maxY <= minY) {
    return null;
  }

  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const index = (y * sampleWidth + x) * 4;
      const red = imageData[index];
      const green = imageData[index + 1];
      const blue = imageData[index + 2];
      const luminance = relativeLuminance(red, green, blue);
      const expectedDistance = expectedTextColor
        ? (Math.abs(red - expectedTextColor[0]) +
            Math.abs(green - expectedTextColor[1]) +
            Math.abs(blue - expectedTextColor[2])) / 3
        : Number.POSITIVE_INFINITY;
      const distance = channelDistance(
        `#${toHexChannel(red)}${toHexChannel(green)}${toHexChannel(blue)}`,
        backgroundColor
      );

      const matchesExpectedText =
        expectedDistance <= 82 && Math.abs(luminance - backgroundLuminance) >= 0.08;

      if (!matchesExpectedText && Math.abs(luminance - backgroundLuminance) < 0.18 && distance < 46) {
        continue;
      }

      rowCounts[y - minY] += 1;
      colCounts[x - minX] += 1;
      inkCount += 1;
    }
  }

  const sampleArea = Math.max(1, (maxX - minX) * (maxY - minY));
  if (inkCount < 12 || inkCount / sampleArea > 0.48) {
    return null;
  }

  const rowThreshold = Math.max(2, Math.round((maxX - minX) * 0.012));
  const colThreshold = Math.max(2, Math.round((maxY - minY) * 0.012));
  const firstRow = rowCounts.findIndex((count) => count >= rowThreshold);
  const lastRow = rowCounts.findLastIndex((count) => count >= rowThreshold);
  const firstCol = colCounts.findIndex((count) => count >= colThreshold);
  const lastCol = colCounts.findLastIndex((count) => count >= colThreshold);

  if (firstRow === -1 || firstCol === -1) {
    return null;
  }

  const result = {
    x: minX + firstCol,
    y: minY + firstRow,
    width: Math.max(1, lastCol - firstCol + 1),
    height: Math.max(1, lastRow - firstRow + 1)
  };

  if (result.width < 4 || result.height < 3) {
    return null;
  }

  return result;
}

export function chooseCoverMode(textureAnalysis) {
  if (!textureAnalysis || textureAnalysis.sampleCount < 12) {
    return "image";
  }

  if (
    textureAnalysis.dominantColorShare >= 0.42 &&
    textureAnalysis.luminanceVariance <= 0.012
  ) {
    return "ui";
  }

  if (
    textureAnalysis.quantizedColorCount <= 6 &&
    textureAnalysis.luminanceVariance <= 0.02
  ) {
    return "ui";
  }

  if (
    textureAnalysis.dominantColorShare >= 0.18 &&
    textureAnalysis.quantizedColorCount <= 14 &&
    textureAnalysis.luminanceVariance <= 0.02
  ) {
    return "ui";
  }

  return "image";
}

export function classifyTextSurface(innerAnalysis, outerAnalysis, rect) {
  const innerMode = chooseCoverMode(innerAnalysis);
  const outerMode = chooseCoverMode(outerAnalysis);
  const aspectRatio = rect.width / Math.max(1, rect.height);
  const paletteDistance = colorDistance(innerAnalysis?.backgroundColor, outerAnalysis?.backgroundColor);

  if (innerMode === "ui" && outerMode === "ui" && paletteDistance <= 18) {
    return "plain-text";
  }

  if (innerMode === "ui" && paletteDistance >= 20) {
    if (aspectRatio >= 3.2) {
      return "caption-strip";
    }
    return "speech-bubble";
  }

  if (outerMode === "ui") {
    return "plain-text";
  }

  return "image-text";
}

export function resolveCoverGeometry(rect, containerKind) {
  switch (containerKind) {
    case "caption-strip":
      return {
        padding: {
          bottom: Math.max(4, Math.round(rect.height * 0.08)),
          left: Math.max(5, Math.round(rect.width * 0.025)),
          right: Math.max(5, Math.round(rect.width * 0.025)),
          top: Math.max(4, Math.round(rect.height * 0.08))
        },
        radius: 5
      };
    case "speech-bubble":
    case "ui-card":
      return {
        padding: {
          bottom: Math.max(5, Math.round(rect.height * 0.055)),
          left: Math.max(6, Math.round(rect.width * 0.045)),
          right: Math.max(6, Math.round(rect.width * 0.045)),
          top: Math.max(5, Math.round(rect.height * 0.055))
        },
        radius: 8
      };
    case "plain-text":
      return {
        padding: {
          bottom: Math.max(4, Math.round(rect.height * 0.08)),
          left: Math.max(5, Math.round(rect.width * 0.03)),
          right: Math.max(5, Math.round(rect.width * 0.03)),
          top: Math.max(4, Math.round(rect.height * 0.08))
        },
        radius: 2
      };
    default:
      return {
        padding: {
          bottom: Math.max(6, Math.round(rect.height * 0.12)),
          left: Math.max(6, Math.round(rect.width * 0.04)),
          right: Math.max(6, Math.round(rect.width * 0.04)),
          top: Math.max(6, Math.round(rect.height * 0.12))
        },
        radius: 6
      };
  }
}

export function resolveSolidCoverPadding(rect) {
  const geometry = resolveCoverGeometry(rect, "speech-bubble");
  return {
    horizontal: geometry.padding.left,
    vertical: geometry.padding.top
  };
}

export function resolveTextVerticalAlign(containerKind, suggestedAlign = "auto") {
  if (["top", "middle", "bottom"].includes(suggestedAlign)) {
    return suggestedAlign;
  }

  switch (containerKind) {
    case "caption-strip":
      return "middle";
    case "plain-text":
    case "speech-bubble":
    case "ui-card":
      return "top";
    default:
      return "middle";
  }
}

export function resolveTextAreaBackgroundColor(containerKind, innerBackgroundColor, outerBackgroundColor) {
  const innerLuminance = hexLuminance(innerBackgroundColor);
  const outerLuminance = hexLuminance(outerBackgroundColor);

  if (
    outerLuminance !== null &&
    innerLuminance !== null &&
    outerLuminance >= 0.72 &&
    innerLuminance <= 0.38
  ) {
    return outerBackgroundColor;
  }

  if (containerKind === "image-text" || containerKind === "plain-text") {
    return outerBackgroundColor || innerBackgroundColor;
  }

  return innerBackgroundColor || outerBackgroundColor;
}

export function resolveRenderedContainerKind(modelContainerKind, detectedContainerKind) {
  if (detectedContainerKind === "plain-text") {
    return "plain-text";
  }

  if (modelContainerKind && modelContainerKind !== "auto") {
    return modelContainerKind;
  }

  return detectedContainerKind;
}

export function resolveCoverOpacity(backgroundOpacity) {
  const numericOpacity = Number(backgroundOpacity);
  const fallbackOpacity = Number.isFinite(numericOpacity) ? numericOpacity : 0.92;
  return clamp(Math.max(fallbackOpacity, 0.965), 0, 1);
}
