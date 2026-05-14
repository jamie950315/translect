import { DEFAULT_SETTINGS, MESSAGE_TYPES, PAGE_ACTIONS } from "../shared/defaults.js";
import { denormalizeSettings, normalizeSettings } from "../shared/settings.js";

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
  saveButton: document.getElementById("saveButton"),
  shortcutText: document.getElementById("shortcutText"),
  status: document.getElementById("status"),
  targetLanguage: document.getElementById("targetLanguage"),
  triggerUsesAutoMode: document.getElementById("triggerUsesAutoMode"),
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
  elements.useIosOcrServer.checked = values.useIosOcrServer;
  elements.useMacosVisionOcr.checked = values.useMacosVisionOcr;
  updateProviderSettingsVisibility();
}

function updateProviderSettingsVisibility() {
  elements.macosVisionSettings.hidden = !elements.useMacosVisionOcr.checked;
  elements.iosOcrSettings.hidden = !elements.useIosOcrServer.checked;
}

function selectOcrProvider(provider) {
  if (provider === "macos" && elements.useMacosVisionOcr.checked) {
    elements.useIosOcrServer.checked = false;
  }
  if (provider === "ios" && elements.useIosOcrServer.checked) {
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
  await sendMessage({
    type: MESSAGE_TYPES.DISPATCH_ACTIVE_TAB,
    action: PAGE_ACTIONS.SETTINGS_UPDATED
  });
}

async function pasteApiKeyFromClipboard() {
  elements.apiKey.focus();

  if (!navigator.clipboard?.readText) {
    throw new Error("Clipboard paste is not available in this popup.");
  }

  let text = "";
  try {
    text = await navigator.clipboard.readText();
  } catch {
    throw new Error("Clipboard permission is blocked. Reload the extension after rebuilding.");
  }

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
  const activeCommand = response?.commands?.find((command) => command.name === "activate-translation");
  elements.shortcutText.textContent = activeCommand?.shortcut || "Not assigned";
}

async function initialize() {
  const response = await sendMessage({ type: MESSAGE_TYPES.GET_SETTINGS });
  fillForm(normalizeSettings(response?.settings || DEFAULT_SETTINGS));
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

initialize().catch((error) => {
  showStatus(error.message, true);
});
