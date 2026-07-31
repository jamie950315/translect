import { installWebExtensionApiCompatibility } from "../shared/browser-compat.js";
import {
  COMMANDS,
  DEFAULT_SETTINGS,
  MESSAGE_TYPES,
  PAGE_ACTIONS,
  STORAGE_KEY
} from "../shared/defaults.js";
import { getExtensionCommands } from "../shared/command-support.js";
import {
  buildChatCompletionsPayload,
  extractAssistantText,
  parseTranslationResponse
} from "../shared/api.js";
import {
  buildTextTranslationPayload,
  mergeOcrAndTranslationResults,
  normalizeIosOcrResult
} from "../shared/ios-ocr.js";
import {
  buildMacosVisionTextTranslationPayload,
  mergeMacosVisionTranslationResults,
  normalizeMacosVisionOcrResult
} from "../shared/macos-vision-ocr.js";
import {
  getSettingsValidationError,
  normalizeSettings
} from "../shared/settings.js";
import { createCaptureVisibleTabLimiter } from "./capture-rate-limit.js";

installWebExtensionApiCompatibility();

const scheduleVisibleTabCapture = createCaptureVisibleTabLimiter();

async function getStoredSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeSettings(result[STORAGE_KEY] || DEFAULT_SETTINGS);
}

async function saveStoredSettings(inputSettings = {}) {
  const currentSettings = await getStoredSettings();
  const nextSettings = normalizeSettings({
    ...currentSettings,
    ...inputSettings
  });

  await chrome.storage.local.set({
    [STORAGE_KEY]: nextSettings
  });
  await syncActionBadge(nextSettings);

  return nextSettings;
}

async function syncActionBadge(settings) {
  if (settings.alwaysAutoDetect) {
    await chrome.action.setBadgeBackgroundColor({ color: "#a13f2c" });
    await chrome.action.setBadgeText({ text: "AUTO" });
    await chrome.action.setTitle({
      title: "Translect (always auto detect enabled)"
    });
    return;
  }

  await chrome.action.setBadgeText({ text: "" });
  await chrome.action.setTitle({ title: "Translect" });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  if (!tab?.id) {
    throw new Error("No active tab is available.");
  }

  return tab;
}

async function injectCurrentContentScript(tab) {
  if (!tab?.id || !/^https?:|^file:/u.test(tab.url || "")) {
    return;
  }

  try {
    await chrome.scripting.executeScript({
      files: ["content.js"],
      target: { tabId: tab.id }
    });
  } catch (error) {
    console.warn("Could not inject the current Translect content script.", error);
  }
}

async function dispatchToActiveTab(action) {
  const tab = await getActiveTab();
  await injectCurrentContentScript(tab);

  try {
    return await chrome.tabs.sendMessage(tab.id, {
      type: MESSAGE_TYPES.PAGE_ACTION,
      action
    });
  } catch (error) {
    console.warn("Current Translect content script did not answer; trying legacy channel.", error);
    return chrome.tabs.sendMessage(tab.id, {
      type: "page-action",
      action
    });
  }
}

function buildRequestHeaders(apiKey) {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

async function parseJsonSafely(response) {
  const text = await response.text();
  try {
    return {
      json: JSON.parse(text),
      rawText: text
    };
  } catch {
    return {
      json: null,
      rawText: text
    };
  }
}

async function requestChatCompletion(apiEndpoint, apiKey, payload) {
  let response = await fetch(apiEndpoint, {
    method: "POST",
    headers: buildRequestHeaders(apiKey),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const failed = await parseJsonSafely(response);
    const errorText =
      failed.json?.error?.message ||
      failed.json?.error ||
      failed.rawText ||
      "The translation API request failed.";

    if (
      (response.status === 400 || response.status === 422) &&
      /response_format/i.test(errorText)
    ) {
      const fallbackPayload = { ...payload };
      delete fallbackPayload.response_format;
      response = await fetch(apiEndpoint, {
        method: "POST",
        headers: buildRequestHeaders(apiKey),
        body: JSON.stringify(fallbackPayload)
      });
    } else {
      throw new Error(errorText);
    }
  }

  if (!response.ok) {
    const failed = await parseJsonSafely(response);
    throw new Error(
      failed.json?.error?.message ||
        failed.json?.error ||
        failed.rawText ||
        "The translation API request failed."
    );
  }

  return response.json();
}

function dataUrlToBlob(dataUrl) {
  const [meta, base64] = String(dataUrl || "").split(",");
  const mime = /^data:([^;]+)/.exec(meta || "")?.[1] || "image/png";
  const binary = atob(base64 || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
}

async function requestIosOcr(settings, request) {
  const formData = new FormData();
  formData.append("file", dataUrlToBlob(request.imageDataUrl), `${request.id}.png`);

  const response = await fetch(settings.iosOcrEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/json"
    },
    body: formData
  });

  if (!response.ok) {
    const failed = await parseJsonSafely(response);
    throw new Error(
      failed.json?.message ||
        failed.json?.error ||
        failed.rawText ||
        "The iOS OCR Server request failed."
    );
  }

  const responseJson = await response.json();
  if (responseJson?.success === false) {
    throw new Error(responseJson.message || "The iOS OCR Server could not read the image.");
  }

  return normalizeIosOcrResult(request.id, responseJson);
}

async function requestIosOcrTranslations(settings, requests) {
  const ocrImages = await Promise.all(
    requests.map((request) => requestIosOcr(settings, request))
  );

  if (!ocrImages.some((image) => image.blocks.length)) {
    return requests.map((request) => ({
      id: request.id,
      translation: { blocks: [] }
    }));
  }

  const payload = buildTextTranslationPayload({
    model: settings.model,
    ocrImages,
    targetLanguage: settings.targetLanguage
  });
  const responseJson = await requestChatCompletion(
    settings.apiEndpoint,
    settings.apiKey,
    payload
  );
  const assistantText = extractAssistantText(responseJson);
  const merged = mergeOcrAndTranslationResults(ocrImages, assistantText);
  const mergedById = new Map(merged.map((item) => [item.imageId, item.translation]));

  return requests.map((request) => ({
    id: request.id,
    translation: mergedById.get(request.id) || { blocks: [] }
  }));
}

async function sendNativeMessage(hostName, message) {
  if (!chrome.runtime.sendNativeMessage) {
    throw new Error("Native messaging is not available in this browser.");
  }

  try {
    return await chrome.runtime.sendNativeMessage(hostName, message);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    if (/native messaging host not found/i.test(messageText)) {
      throw new Error(
        `macOS Vision OCR host is not installed for this extension ID (${chrome.runtime.id}). Run: npm run install:macos-ocr-host -- --extension-id ${chrome.runtime.id}`
      );
    }
    throw error;
  }
}

async function requestMacosVisionOcr(settings, request) {
  const responseJson = await sendNativeMessage(settings.macosVisionHostName, {
    id: request.id,
    imageDataUrl: request.imageDataUrl
  });

  if (!responseJson?.ok) {
    throw new Error(
      responseJson?.error ||
        "The macOS Vision OCR native host could not read the image."
    );
  }

  return normalizeMacosVisionOcrResult(request.id, responseJson);
}

async function requestMacosVisionOcrTranslations(settings, requests) {
  const ocrImages = await Promise.all(
    requests.map((request) => requestMacosVisionOcr(settings, request))
  );

  if (!ocrImages.some((image) => image.blocks.length)) {
    return requests.map((request) => ({
      id: request.id,
      translation: { blocks: [] }
    }));
  }

  const payload = buildMacosVisionTextTranslationPayload({
    model: settings.model,
    ocrImages,
    targetLanguage: settings.targetLanguage
  });
  const responseJson = await requestChatCompletion(
    settings.apiEndpoint,
    settings.apiKey,
    payload
  );
  const assistantText = extractAssistantText(responseJson);
  const merged = mergeMacosVisionTranslationResults(ocrImages, assistantText);
  const mergedById = new Map(merged.map((item) => [item.imageId, item.translation]));

  return requests.map((request) => ({
    id: request.id,
    translation: mergedById.get(request.id) || { blocks: [] }
  }));
}

async function requestTranslation(settings, imageDataUrl) {
  if (settings.useMacosVisionOcr) {
    const [result] = await requestMacosVisionOcrTranslations(settings, [
      {
        id: "image-0",
        imageDataUrl
      }
    ]);
    return result.translation;
  }

  if (settings.useIosOcrServer) {
    const [result] = await requestIosOcrTranslations(settings, [
      {
        id: "image-0",
        imageDataUrl
      }
    ]);
    return result.translation;
  }

  const payload = buildChatCompletionsPayload({
    imageDataUrl,
    model: settings.model,
    targetLanguage: settings.targetLanguage
  });

  const responseJson = await requestChatCompletion(
    settings.apiEndpoint,
    settings.apiKey,
    payload
  );
  const assistantText = extractAssistantText(responseJson);
  return parseTranslationResponse(assistantText);
}

async function requestTranslations(settings, requests) {
  if (settings.useMacosVisionOcr) {
    return requestMacosVisionOcrTranslations(settings, requests);
  }

  if (settings.useIosOcrServer) {
    return requestIosOcrTranslations(settings, requests);
  }

  return Promise.all(
    requests.map(async (request) => ({
      id: request.id,
      translation: await requestTranslation(settings, request.imageDataUrl)
    }))
  );
}

async function captureVisibleTab(sender) {
  const windowId = sender?.tab?.windowId || (await getActiveTab()).windowId;
  return scheduleVisibleTabCapture(() =>
    chrome.tabs.captureVisibleTab(windowId, { format: "png" })
  );
}

function arrayBufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function fetchImageDataUrl(url) {
  if (/^data:image\//i.test(url || "")) {
    return url;
  }

  if (!/^https?:\/\//i.test(url || "")) {
    throw new Error("Unsupported image URL.");
  }

  const response = await fetch(url, {
    cache: "force-cache",
    credentials: "omit"
  });
  if (!response.ok) {
    throw new Error(`Could not fetch image (${response.status}).`);
  }

  const blob = await response.blob();
  const mimeType = blob.type || response.headers.get("Content-Type") || "image/png";
  if (!/^image\//i.test(mimeType)) {
    throw new Error("Fetched resource is not an image.");
  }

  return `data:${mimeType};base64,${arrayBufferToBase64(await blob.arrayBuffer())}`;
}

async function toggleAlwaysAutoDetect() {
  const current = await getStoredSettings();
  const updated = await saveStoredSettings({
    alwaysAutoDetect: !current.alwaysAutoDetect
  });

  try {
    await dispatchToActiveTab(PAGE_ACTIONS.SETTINGS_UPDATED);
  } catch (error) {
    console.warn("Could not notify the active tab about updated settings.", error);
  }

  return updated;
}

chrome.runtime.onInstalled.addListener(async () => {
  await saveStoredSettings(await getStoredSettings());
});

chrome.runtime.onStartup.addListener(async () => {
  await syncActionBadge(await getStoredSettings());
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_KEY]?.newValue) {
    await syncActionBadge(normalizeSettings(changes[STORAGE_KEY].newValue));
  }
});

if (chrome.commands?.onCommand?.addListener) {
  chrome.commands.onCommand.addListener(async (command) => {
    try {
      if (command === COMMANDS.ACTIVATE_TRANSLATION) {
        const settings = await getStoredSettings();
        await dispatchToActiveTab(
          settings.triggerUsesAutoMode
            ? PAGE_ACTIONS.AUTO_TRANSLATE_VISIBLE
            : PAGE_ACTIONS.START_MANUAL_SELECTION
        );
        return;
      }

      if (command === COMMANDS.TOGGLE_ALWAYS_AUTO_DETECT) {
        await toggleAlwaysAutoDetect();
      }
    } catch (error) {
      console.warn("Command handling failed.", error);
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  async function handle() {
    switch (message?.type) {
      case MESSAGE_TYPES.CAPTURE_VISIBLE_TAB: {
        return {
          dataUrl: await captureVisibleTab(sender)
        };
      }
      case MESSAGE_TYPES.DISPATCH_ACTIVE_TAB: {
        await dispatchToActiveTab(message.action);
        return {};
      }
      case MESSAGE_TYPES.FETCH_IMAGE_DATA: {
        return {
          dataUrl: await fetchImageDataUrl(message.url)
        };
      }
      case MESSAGE_TYPES.GET_COMMANDS: {
        return {
          commands: await getExtensionCommands(chrome.commands)
        };
      }
      case MESSAGE_TYPES.GET_SETTINGS: {
        return {
          settings: await getStoredSettings()
        };
      }
      case MESSAGE_TYPES.SAVE_SETTINGS: {
        return {
          settings: await saveStoredSettings(message.settings)
        };
      }
      case MESSAGE_TYPES.TOGGLE_ALWAYS_AUTO_DETECT: {
        return {
          settings: await toggleAlwaysAutoDetect()
        };
      }
      case MESSAGE_TYPES.TRANSLATE_REGION: {
        const settings = await getStoredSettings();
        const validationError = getSettingsValidationError(settings);
        if (validationError) {
          throw new Error(validationError);
        }

        return {
          translation: await requestTranslation(settings, message.imageDataUrl)
        };
      }
      case MESSAGE_TYPES.TRANSLATE_REGIONS: {
        const settings = await getStoredSettings();
        const validationError = getSettingsValidationError(settings);
        if (validationError) {
          throw new Error(validationError);
        }

        const requests = Array.isArray(message.requests) ? message.requests : [];
        return {
          translations: await requestTranslations(settings, requests)
        };
      }
      default:
        return null;
    }
  }

  handle()
    .then((payload) => {
      if (payload === null) {
        sendResponse({ ok: false, error: "Unsupported message." });
        return;
      }
      sendResponse({ ok: true, ...payload });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });

  return true;
});
