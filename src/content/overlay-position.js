const pendingRefreshes = new WeakSet();

function updateStyle(style, key, value) {
  if (style[key] !== value) style[key] = value;
}

function refreshOverlayPositions(entries) {
  for (const entry of entries) {
    const rect = entry.getRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      updateStyle(entry.node.style, "display", "none");
      continue;
    }

    updateStyle(entry.node.style, "display", "block");
    updateStyle(entry.node.style, "left", `${rect.x}px`);
    updateStyle(entry.node.style, "top", `${rect.y}px`);
    updateStyle(entry.node.style, "width", `${rect.width}px`);
    updateStyle(entry.node.style, "height", `${rect.height}px`);
  }
}

export function scheduleOverlayPositionRefresh(entries, requestAnimationFrame) {
  if (!entries.size || pendingRefreshes.has(entries)) return;
  pendingRefreshes.add(entries);
  // Safari needs the initial position before its next animation frame.
  refreshOverlayPositions(entries);
  requestAnimationFrame(() => {
    pendingRefreshes.delete(entries);
    refreshOverlayPositions(entries);
  });
}
