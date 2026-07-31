const SAFARI_UNSUPPORTED_PERMISSIONS = new Set(["clipboardRead"]);

export function createSafariManifest(sourceManifest) {
  if (!sourceManifest || typeof sourceManifest !== "object") {
    throw new TypeError("A source manifest object is required.");
  }

  const { key: _chromeExtensionKey, ...safariManifest } = sourceManifest;
  const { type: _moduleType, ...safariBackground } = sourceManifest.background || {};

  return {
    ...safariManifest,
    ...(sourceManifest.background ? { background: safariBackground } : {}),
    permissions: (sourceManifest.permissions || []).filter(
      (permission) => !SAFARI_UNSUPPORTED_PERMISSIONS.has(permission)
    )
  };
}
