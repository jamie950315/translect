export function installWebExtensionApiCompatibility(globalObject = globalThis) {
  if (!globalObject?.chrome && globalObject?.browser) {
    globalObject.chrome = globalObject.browser;
  }

  return globalObject?.chrome || globalObject?.browser || null;
}

export function sendNativeMessageToNativeApp(
  hostName,
  message,
  globalObject = globalThis
) {
  const chromeApi = globalObject?.chrome;
  const browserApi = globalObject?.browser;
  const runtime = chromeApi?.runtime || browserApi?.runtime;
  const sendNativeMessage = runtime?.sendNativeMessage;

  if (typeof sendNativeMessage !== "function") {
    throw new Error("Native messaging is not available in this browser.");
  }

  if (browserApi && runtime === browserApi.runtime) {
    return sendNativeMessage.call(runtime, message);
  }

  return sendNativeMessage.call(runtime, hostName, message);
}
