import { DEFAULT_SETTINGS } from "./defaults.js";

function cleanString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export function normalizeApiEndpoint(value) {
  const raw = cleanString(value, DEFAULT_SETTINGS.apiEndpoint);
  if (!raw) {
    return DEFAULT_SETTINGS.apiEndpoint;
  }

  const withoutTrailingSlash = raw.replace(/\/+$/, "");
  if (withoutTrailingSlash.endsWith("/responses")) {
    return withoutTrailingSlash.replace(/\/responses$/, "/chat/completions");
  }

  if (withoutTrailingSlash.endsWith("/chat/completions")) {
    return withoutTrailingSlash;
  }

  return `${withoutTrailingSlash}/chat/completions`;
}

export function normalizeIosOcrEndpoint(value) {
  const raw = cleanString(value, DEFAULT_SETTINGS.iosOcrEndpoint);
  if (!raw) {
    return "";
  }

  const withoutTrailingSlash = raw.replace(/\/+$/, "");
  if (withoutTrailingSlash.endsWith("/upload")) {
    return withoutTrailingSlash;
  }

  return `${withoutTrailingSlash}/upload`;
}

export function normalizeSettings(rawSettings = {}) {
  return {
    apiEndpoint: normalizeApiEndpoint(rawSettings.apiEndpoint || DEFAULT_SETTINGS.apiEndpoint),
    apiKey: cleanString(rawSettings.apiKey),
    iosOcrEndpoint: normalizeIosOcrEndpoint(
      rawSettings.iosOcrEndpoint || DEFAULT_SETTINGS.iosOcrEndpoint
    ),
    model: cleanString(rawSettings.model, DEFAULT_SETTINGS.model) || DEFAULT_SETTINGS.model,
    targetLanguage:
      cleanString(rawSettings.targetLanguage, DEFAULT_SETTINGS.targetLanguage) ||
      DEFAULT_SETTINGS.targetLanguage,
    alwaysAutoDetect: Boolean(rawSettings.alwaysAutoDetect),
    triggerUsesAutoMode: Boolean(rawSettings.triggerUsesAutoMode),
    useIosOcrServer: Boolean(rawSettings.useIosOcrServer)
  };
}

export function denormalizeSettings(settings) {
  const endpoint = cleanString(settings.apiEndpoint, DEFAULT_SETTINGS.apiEndpoint);
  const iosOcrEndpoint = cleanString(settings.iosOcrEndpoint, DEFAULT_SETTINGS.iosOcrEndpoint);
  return {
    ...settings,
    apiEndpoint: endpoint.replace(/\/chat\/completions$/, ""),
    iosOcrEndpoint: iosOcrEndpoint.replace(/\/upload$/, "")
  };
}

export function settingsAreReady(settings) {
  return Boolean(
    settings.apiEndpoint && settings.apiKey && settings.model && settings.targetLanguage
  );
}

export function getSettingsValidationError(settings) {
  if (!settings.apiEndpoint) {
    return "API endpoint is required.";
  }
  if (!settings.apiKey) {
    return "API key is required.";
  }
  if (!settings.model) {
    return "Model ID is required.";
  }
  if (!settings.targetLanguage) {
    return "Target language is required.";
  }
  if (settings.useIosOcrServer && !settings.iosOcrEndpoint) {
    return "iOS OCR Server endpoint is required.";
  }
  return "";
}
