function errorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error || "");
}

function fallbackConfigurationError(settings) {
  if (!settings?.apiEndpoint) {
    return "Configure an OpenAI-compatible API endpoint to use text-only fallback.";
  }
  if (!settings?.apiKey) {
    return "Configure an OpenAI-compatible API key to use text-only fallback.";
  }
  if (!settings?.model) {
    return "Configure an OpenAI-compatible model to use text-only fallback.";
  }

  return "";
}

export function isAppleIntelligenceSensitiveContentError(error) {
  return /may contain sensitive content/i.test(errorMessage(error));
}

export async function requestAppleIntelligenceWithTextFallback({
  request,
  requestAppleIntelligence,
  requestTextFallback,
  settings
}) {
  try {
    return await requestAppleIntelligence(request);
  } catch (error) {
    if (!isAppleIntelligenceSensitiveContentError(error)) {
      throw error;
    }

    const configurationError = fallbackConfigurationError(settings);
    if (configurationError) {
      throw new Error(configurationError);
    }

    const fallbackResults = await requestTextFallback([request]);
    const fallbackResult = fallbackResults.find((result) => result?.id === request.id);
    if (!fallbackResult) {
      throw new Error("The text-only fallback did not return a translation.");
    }

    return fallbackResult;
  }
}
