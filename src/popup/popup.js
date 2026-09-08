import { installWebExtensionApiCompatibility } from "../shared/browser-compat.js";
import { MESSAGE_TYPES, PAGE_ACTIONS } from "../shared/defaults.js";
import { denormalizeSettings, normalizeSettings } from "../shared/settings.js";

installWebExtensionApiCompatibility();

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

const elements = {
  alwaysAutoDetect: document.getElementById("alwaysAutoDetect"),
  apiEndpoint: document.getElementById("apiEndpoint"),
  apiKey: document.getElementById("apiKey"),
  autoButton: document.getElementById("autoButton"),
  clearButton: document.getElementById("clearButton"),
  extensionIdText: document.getElementById("extensionIdText"),
  iosOcrEndpoint: document.getElementById("iosOcrEndpoint"),
  iosOcrSettings: document.getElementById("iosOcrSettings"),
  macosVisionHostName: document.getElementById("macosVisionHostName"),
  macosVisionSettings: document.getElementById("macosVisionSettings"),
  manualButton: document.getElementById("manualButton"),
  model: document.getElementById("model"),
  pasteApiKeyButton: document.getElementById("pasteApiKeyButton"),
  remoteApiSettings: document.getElementById("remoteApiSettings"),
  saveButton: document.getElementById("saveButton"),
  shortcutText: document.getElementById("shortcutText"),
  status: document.getElementById("status"),
  targetLanguage: document.getElementById("targetLanguage"),
  triggerUsesAutoMode: document.getElementById("triggerUsesAutoMode"),
  useAppleIntelligence: document.getElementById("useAppleIntelligence"),
  useIosOcrServer: document.getElementById("useIosOcrServer"),
  useMacosVisionOcr: document.getElementById("useMacosVisionOcr")
};

function showStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.style.color = isError ? "#7f2a1c" : "#a13f2c";
}

function readFormSettings() {
  return normalizeSettings({
    alwaysAutoDetect: elements.alwaysAutoDetect.checked,
    apiEndpoint: elements.apiEndpoint.value,
    apiKey: elements.apiKey.value,
    iosOcrEndpoint: elements.iosOcrEndpoint.value,
    macosVisionHostName: elements.macosVisionHostName.value,
    model: elements.model.value,
    targetLanguage: elements.targetLanguage.value,
    triggerUsesAutoMode: elements.triggerUsesAutoMode.checked,
    useAppleIntelligence: elements.useAppleIntelligence.checked,
    useIosOcrServer: elements.useIosOcrServer.checked,
    useMacosVisionOcr: elements.useMacosVisionOcr.checked
  });
}

function fillForm(settings) {
  const values = denormalizeSettings(settings);
  elements.alwaysAutoDetect.checked = values.alwaysAutoDetect;
  elements.apiEndpoint.value = values.apiEndpoint;
  elements.apiKey.value = values.apiKey;
  elements.iosOcrEndpoint.value = values.iosOcrEndpoint;
  elements.macosVisionHostName.value = values.macosVisionHostName;
  elements.model.value = values.model;
  elements.targetLanguage.value = values.targetLanguage;
  elements.triggerUsesAutoMode.checked = values.triggerUsesAutoMode;
  elements.useAppleIntelligence.checked = values.useAppleIntelligence;
  elements.useIosOcrServer.checked = values.useIosOcrServer;
  elements.useMacosVisionOcr.checked = values.useMacosVisionOcr;
  updateProviderSettingsVisibility();
}

function updateProviderSettingsVisibility() {
  elements.remoteApiSettings.hidden = elements.useAppleIntelligence.checked;
  elements.macosVisionSettings.hidden = !elements.useMacosVisionOcr.checked;
  elements.iosOcrSettings.hidden = !elements.useIosOcrServer.checked;
}

function selectOcrProvider(provider) {
  if (provider === "apple" && elements.useAppleIntelligence.checked) {
    elements.useMacosVisionOcr.checked = false;
    elements.useIosOcrServer.checked = false;
  }
  if (provider === "macos" && elements.useMacosVisionOcr.checked) {
    elements.useAppleIntelligence.checked = false;
    elements.useIosOcrServer.checked = false;
  }
  if (provider === "ios" && elements.useIosOcrServer.checked) {
    elements.useAppleIntelligence.checked = false;
    elements.useMacosVisionOcr.checked = false;
  }
  updateProviderSettingsVisibility();
}

async function saveSettings(message = "Settings saved.") {
  const settings = readFormSettings();
  const response = await sendMessage({
    type: MESSAGE_TYPES.SAVE_SETTINGS,
    settings
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Could not save settings.");
  }

  showStatus(message);
  await runPageAction(PAGE_ACTIONS.SETTINGS_UPDATED);
}

async function pasteApiKeyFromClipboard() {
  elements.apiKey.focus();

  if (!navigator.clipboard?.readText) {
    throw new Error("Clipboard paste is not available in this popup.");
  }

  const text = await navigator.clipboard.readText();

  if (!text.trim()) {
    throw new Error("Clipboard is empty.");
  }

  elements.apiKey.value = text.trim();
  elements.apiKey.dispatchEvent(new Event("input", { bubbles: true }));
  showStatus("API key pasted.");
}

async function runPageAction(action) {
  const response = await sendMessage({
    type: MESSAGE_TYPES.DISPATCH_ACTIVE_TAB,
    action
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Could not send the action to the current tab.");
  }
}

async function initShortcutText() {
  const response = await sendMessage({ type: MESSAGE_TYPES.GET_COMMANDS });
  if (!response?.ok || !Array.isArray(response.commands)) {
    throw new Error(response?.error || "Could not load keyboard shortcuts.");
  }
  const activeCommand = response?.commands?.find((command) => command.name === "activate-translation");
  elements.shortcutText.textContent = activeCommand?.shortcut || "Not assigned";
}

async function initialize() {
  const response = await sendMessage({ type: MESSAGE_TYPES.GET_SETTINGS });
  if (!response?.ok || !response.settings || typeof response.settings !== "object") {
    throw new Error(response?.error || "Could not load saved settings.");
  }
  fillForm(normalizeSettings(response.settings));
  for (const button of [elements.saveButton, elements.manualButton, elements.autoButton]) {
    button.disabled = false;
  }
  elements.extensionIdText.textContent = chrome.runtime.id;
  await initShortcutText();
}

elements.saveButton.addEventListener("click", async () => {
  try {
    await saveSettings();
  } catch (error) {
    showStatus(error.message, true);
  }
});

elements.pasteApiKeyButton.addEventListener("click", async () => {
  try {
    await pasteApiKeyFromClipboard();
  } catch (error) {
    showStatus(error.message, true);
    elements.apiKey.focus();
  }
});

elements.useMacosVisionOcr.addEventListener("change", () => {
  selectOcrProvider("macos");
});

elements.useAppleIntelligence.addEventListener("change", () => {
  selectOcrProvider("apple");
});

elements.useIosOcrServer.addEventListener("change", () => {
  selectOcrProvider("ios");
});

elements.manualButton.addEventListener("click", async () => {
  try {
    await saveSettings("Settings saved.");
    const settings = readFormSettings();
    await runPageAction(
      settings.triggerUsesAutoMode
        ? PAGE_ACTIONS.AUTO_TRANSLATE_VISIBLE
        : PAGE_ACTIONS.START_MANUAL_SELECTION
    );
    window.close();
  } catch (error) {
    showStatus(error.message, true);
  }
});

elements.autoButton.addEventListener("click", async () => {
  try {
    await saveSettings("Settings saved.");
    await runPageAction(PAGE_ACTIONS.AUTO_TRANSLATE_VISIBLE);
    window.close();
  } catch (error) {
    showStatus(error.message, true);
  }
});

elements.clearButton.addEventListener("click", async () => {
  try {
    await runPageAction(PAGE_ACTIONS.CLEAR_OVERLAYS);
    showStatus("Cleared page overlays.");
  } catch (error) {
    showStatus(error.message, true);
  }
});

for (const button of [elements.saveButton, elements.manualButton, elements.autoButton]) {
  button.disabled = true;
}

initialize().catch((error) => {
  showStatus(error.message, true);
});
