export function installWebExtensionApiCompatibility(globalObject = globalThis) {
  if (!globalObject?.chrome && globalObject?.browser) {
    globalObject.chrome = globalObject.browser;
  }

  return globalObject?.chrome || globalObject?.browser || null;
}
