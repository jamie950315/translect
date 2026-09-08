// Keep a deadline through body consumption as well as the initial connection.
// Errors are returned to the caller, never retried with a different API contract.
export async function requestJson(url, options, label = "Translation API", timeoutMs = 120_000) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    const text = await response.text();
    let detail = text;
    try {
      const json = JSON.parse(text);
      const error = json?.error?.message || json?.message || json?.error;
      if (error) detail = typeof error === "string" ? error : JSON.stringify(error);
    } catch {
      // HTTP errors can legitimately be plain text (e.g. a reverse proxy).
      // Preserve that response instead of replacing the HTTP failure with a parse error.
    }
    throw new Error(`${label} failed (HTTP ${response.status}): ${detail || response.statusText}`);
  }
  return response.json();
}

export function requestChatCompletion(apiEndpoint, apiKey, payload) {
  return requestJson(apiEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}
