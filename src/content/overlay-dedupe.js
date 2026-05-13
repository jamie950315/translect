function area(rect) {
  return Math.max(0, Number(rect?.width) || 0) * Math.max(0, Number(rect?.height) || 0);
}

export function rectCoverageRatio(a, b) {
  const left = Math.max(Number(a?.x) || 0, Number(b?.x) || 0);
  const top = Math.max(Number(a?.y) || 0, Number(b?.y) || 0);
  const right = Math.min(
    (Number(a?.x) || 0) + (Number(a?.width) || 0),
    (Number(b?.x) || 0) + (Number(b?.width) || 0)
  );
  const bottom = Math.min(
    (Number(a?.y) || 0) + (Number(a?.height) || 0),
    (Number(b?.y) || 0) + (Number(b?.height) || 0)
  );
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const smallerArea = Math.min(area(a), area(b));

  return smallerArea > 0 ? intersection / smallerArea : 0;
}

export function shouldReplaceOverlayRect(existingRect, incomingRect) {
  if (!existingRect || !incomingRect) {
    return false;
  }

  return rectCoverageRatio(existingRect, incomingRect) >= 0.86;
}
