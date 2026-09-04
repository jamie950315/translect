export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeBoundsToPixels(bounds, width, height) {
  const x = (bounds.x / 1000) * width;
  const y = (bounds.y / 1000) * height;
  const boxWidth = (bounds.width / 1000) * width;
  const boxHeight = (bounds.height / 1000) * height;

  return {
    x: clamp(x, 0, width),
    y: clamp(y, 0, height),
    width: clamp(boxWidth, 0, width),
    height: clamp(boxHeight, 0, height),
    rotation: bounds.rotation || 0
  };
}

export function orientProviderTextRect(rect) {
  const rotation = Number(rect?.rotation) || 0;
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const isQuarterTurn =
    (normalizedRotation >= 78 && normalizedRotation <= 102) ||
    (normalizedRotation >= 258 && normalizedRotation <= 282);

  if (!isQuarterTurn) {
    return { ...rect };
  }

  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  return {
    x: centerX - rect.height / 2,
    y: centerY - rect.width / 2,
    width: rect.height,
    height: rect.width,
    rotation
  };
}

export function expandRect(rect, padding, maxWidth, maxHeight) {
  const x = clamp(rect.x - padding, 0, maxWidth);
  const y = clamp(rect.y - padding, 0, maxHeight);
  const right = clamp(rect.x + rect.width + padding, 0, maxWidth);
  const bottom = clamp(rect.y + rect.height + padding, 0, maxHeight);

  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y)
  };
}

export function rectIsLargeEnough(rect, minimumSize = 28) {
  return rect.width >= minimumSize && rect.height >= minimumSize;
}
