import { shouldReplaceOverlayRect } from "./overlay-dedupe.js";

export function isAutoTranslateCandidate({
  naturalWidth,
  naturalHeight,
  rect,
  viewport
}) {
  const width = Number(rect?.width) || 0;
  const height = Number(rect?.height) || 0;
  const x = Number(rect?.x) || 0;
  const y = Number(rect?.y) || 0;
  const largestSide = Math.max(width, height);
  const area = width * height;
  const viewportWidth = Number(viewport?.width) || Number.POSITIVE_INFINITY;
  const viewportHeight = Number(viewport?.height) || Number.POSITIVE_INFINITY;
  const fullyVisible =
    x >= 0 &&
    y >= 0 &&
    x + width <= viewportWidth &&
    y + height <= viewportHeight;

  return (
    naturalWidth > 80 &&
    naturalHeight > 80 &&
    width >= 120 &&
    height >= 80 &&
    largestSide >= 180 &&
    area >= 25000 &&
    fullyVisible
  );
}

function imageResolution(imageElement) {
  return (Number(imageElement.naturalWidth) || 0) * (Number(imageElement.naturalHeight) || 0);
}

export function dedupeImageElementsByVisualRect(imageElements) {
  const measured = imageElements.map((imageElement) => {
    const rect = imageElement.getBoundingClientRect();
    return { imageElement, rect, area: Math.max(0, Number(rect.width) || 0) * Math.max(0, Number(rect.height) || 0) };
  });
  const sorted = measured.sort((a, b) => {
    const areaDelta = b.area - a.area;
    if (Math.abs(areaDelta) > 1) {
      return areaDelta;
    }
    return imageResolution(b.imageElement) - imageResolution(a.imageElement);
  });
  const kept = [];

  for (const candidate of sorted) {
    const isDuplicate = kept.some((keptImage) =>
      shouldReplaceOverlayRect(keptImage.rect, candidate.rect)
    );

    if (!isDuplicate) {
      kept.push(candidate);
    }
  }

  const keptElements = new Set(kept.map(({ imageElement }) => imageElement));
  return imageElements.filter((imageElement) => keptElements.has(imageElement));
}
