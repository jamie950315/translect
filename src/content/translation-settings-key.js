// Never retain credentials or query parameters in persisted cache keys.
function endpointIdentity(value) {
  if (!value) return "";
  const url = new URL(value);
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function translationSettingsKey(settings = {}) {
  if (settings.useAppleIntelligence) {
    return `${String(settings.targetLanguage || "").trim().toLowerCase()}|apple-intelligence:local`;
  }
  const provider = settings.useMacosVisionOcr
    ? `macos-vision:${String(settings.macosVisionHostName || "").trim()}`
    : settings.useIosOcrServer
      ? `ios-ocr:${endpointIdentity(settings.iosOcrEndpoint)}`
      : "vision";
  return [
    String(settings.targetLanguage || "").trim().toLowerCase(),
    String(settings.model || "").trim(),
    endpointIdentity(settings.apiEndpoint),
    provider
  ].join("|");
}
