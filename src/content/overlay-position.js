function refreshOverlayPositions(entries) {
  for (const entry of entries) {
    const rect = entry.getRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      entry.node.style.display = "none";
      continue;
    }

    entry.node.style.display = "block";
    entry.node.style.left = `${rect.x}px`;
    entry.node.style.top = `${rect.y}px`;
    entry.node.style.width = `${rect.width}px`;
    entry.node.style.height = `${rect.height}px`;
  }
}

export function scheduleOverlayPositionRefresh(entries, requestAnimationFrame) {
  refreshOverlayPositions(entries);
  requestAnimationFrame(() => refreshOverlayPositions(entries));
}
