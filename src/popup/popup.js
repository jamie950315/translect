import { installWebExtensionApiCompatibility } from "../shared/browser-compat.js";
import { MESSAGE_TYPES, PAGE_ACTIONS } from "../shared/defaults.js";
import { denormalizeSettings, normalizeSettings } from "../shared/settings.js";

installWebExtensionApiCompatibility();

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

const elements = {
  translateTab: document.getElementById("translateTab"),
  settingsTab: document.getElementById("settingsTab"),
  translatePanel: document.getElementById("translatePanel"),
  settingsPanel: document.getElementById("settingsPanel"),
  panelScroll: document.getElementById("panelScroll"),
  translateFields: document.getElementById("translateFields"),
  behaviorFields: document.getElementById("behaviorFields"),
  settingsFields: document.getElementById("settingsFields"),
  editProviderButton: document.getElementById("editProviderButton"),
  providerSummary: document.getElementById("providerSummary"),
  modelSummary: document.getElementById("modelSummary"),
  storageLabel: document.getElementById("storageLabel"),
  activityIndicator: document.getElementById("activityIndicator"),
  providerSelect: document.getElementById("providerSelect"),
  providerHelp: document.getElementById("providerHelp"),
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
  macRetentionNote: document.getElementById("macRetentionNote"),
  targetLanguage: document.getElementById("targetLanguage"),
  triggerUsesAutoMode: document.getElementById("triggerUsesAutoMode")
};

let settingsLoaded = false;
let busy = false;
let savedDraft = "";
let retainedOnMac = false;
let statusRevision = 0;

function showPane(name, focus = false) {
  for (const pane of ["translate", "settings"]) {
    const selected = name === pane;
    elements[`${pane}Panel`].hidden = !selected;
    elements[`${pane}Tab`].setAttribute("aria-selected", String(selected));
    elements[`${pane}Tab`].tabIndex = selected ? 0 : -1;
  }
  elements.panelScroll.scrollTop = 0;
  if (focus) elements[`${name}Tab`].focus();
}

function setBusy(value) {
  busy = value;
  elements.activityIndicator.hidden = !value;
  for (const key of ["translateFields", "behaviorFields", "settingsFields", "saveButton", "manualButton", "autoButton", "pasteApiKeyButton"]) {
    elements[key].disabled = value || !settingsLoaded;
  }
  elements.clearButton.disabled = value;
}

async function runAction(message, action) {
  if (busy) return;
  setBusy(true);
  showStatus(message);
  try {
    await action();
  } catch (error) {
    showStatus(error.message || String(error), true);
  } finally {
    setBusy(false);
  }
}

function updateDraftState() {
  updateProviderSummary();
  if (!settingsLoaded || busy) return;
  showStatus(JSON.stringify(readFormSettings()) === savedDraft ? "No unsaved changes." : "Unsaved changes");
}

function updateProviderSummary() {
  const provider = elements.providerSelect.value;
  const local = provider === "apple";
  elements.providerSummary.textContent = local ? "Apple Intelligence" : provider === "macos"
    ? "Mac text recognition" : provider === "ios" ? "iPhone text recognition" : "API translation";
  elements.modelSummary.textContent = local ? "Private, on this Mac" : elements.model.value.trim() || "Choose a model in Settings";
  elements.providerHelp.textContent = local ? "Private on-device translation. Requires macOS 26 or later."
    : provider === "macos" ? "Apple Vision reads the text; your API translates it."
    : provider === "ios" ? "Your iPhone reads the text; your API translates it." : "Use your chosen vision model.";
}

function showStatus(message, isError = false) {
  statusRevision += 1;
  elements.status.textContent = message;
  elements.status.setAttribute("data-kind", isError ? "error" : "info");
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
    useAppleIntelligence: elements.providerSelect.value === "apple",
    useIosOcrServer: elements.providerSelect.value === "ios",
    useMacosVisionOcr: elements.providerSelect.value === "macos"
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
  elements.providerSelect.value = values.useAppleIntelligence ? "apple" : values.useMacosVisionOcr ? "macos" : values.useIosOcrServer ? "ios" : "api";
  updateProviderSettingsVisibility();
}

function updateProviderSettingsVisibility() {
  elements.remoteApiSettings.hidden = elements.providerSelect.value === "apple";
  elements.macosVisionSettings.hidden = elements.providerSelect.value !== "macos";
  elements.iosOcrSettings.hidden = elements.providerSelect.value !== "ios";
  updateProviderSummary();
}

function selectOcrProvider() {
  updateProviderSettingsVisibility();
  updateDraftState();
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

  savedDraft = JSON.stringify(settings);
  showStatus(message);
  await runPageAction(PAGE_ACTIONS.SETTINGS_UPDATED);
  showStatus(retainedOnMac ? "Saved on this Mac." : "Settings saved.");
}

async function saveChangedSettings() {
  if (JSON.stringify(readFormSettings()) !== savedDraft) {
    await saveSettings();
  }
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
  const shortcut = activeCommand?.shortcut || "Not assigned";
  elements.shortcutText.textContent = /Command|Meta/.test(shortcut)
    ? shortcut.replace(/Command|Meta/g, "⌘").replace(/Shift/g, "⇧").replace(/Control|Ctrl/g, "⌃").replace(/Option|Alt/g, "⌥").replace(/\+/g, "") : shortcut;
}

async function initialize() {
  const initialStatusRevision = statusRevision;
  const response = await sendMessage({ type: MESSAGE_TYPES.GET_SETTINGS });
  if (!response?.ok || !response.settings || typeof response.settings !== "object") {
    throw new Error(response?.error || "Could not load saved settings.");
  }
  fillForm(normalizeSettings(response.settings));
  elements.macRetentionNote.hidden = !response.settingsRetainedOnMac;
  retainedOnMac = Boolean(response.settingsRetainedOnMac);
  elements.storageLabel.textContent = retainedOnMac ? "On this Mac" : "This browser";
  savedDraft = JSON.stringify(readFormSettings());
  settingsLoaded = true;
  setBusy(busy);
  elements.extensionIdText.textContent = chrome.runtime.id;
  await initShortcutText();
  if (statusRevision === initialStatusRevision) {
    showStatus(elements.providerSelect.value !== "apple" && !elements.apiKey.value
      ? "Add an API key in Settings to start." : "Ready to translate");
  }
}

elements.saveButton.addEventListener("click", () => runAction("Saving settings…", saveSettings));

elements.pasteApiKeyButton.addEventListener("click", () => runAction("Reading clipboard…", pasteApiKeyFromClipboard));

elements.providerSelect.addEventListener("change", selectOcrProvider);

elements.manualButton.addEventListener("click", () => runAction("Preparing translation…", async () => {
    await saveChangedSettings();
    showStatus("Preparing translation…");
    await runPageAction(PAGE_ACTIONS.START_MANUAL_SELECTION);
    window.close();
}));

elements.autoButton.addEventListener("click", () => runAction("Translating visible images…", async () => {
    await saveChangedSettings();
    showStatus("Translating visible images…");
    await runPageAction(PAGE_ACTIONS.AUTO_TRANSLATE_VISIBLE);
    window.close();
}));

elements.clearButton.addEventListener("click", () => runAction("Clearing translations…", async () => {
    await runPageAction(PAGE_ACTIONS.CLEAR_OVERLAYS);
    showStatus("Translations cleared.");
}));

for (const pane of ["translate", "settings"]) {
  elements[`${pane}Tab`].addEventListener("click", () => showPane(pane));
  elements[`${pane}Tab`].addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    showPane(event.key === "Home" ? "translate" : event.key === "End" ? "settings" : pane === "translate" ? "settings" : "translate", true);
  });
}
elements.editProviderButton.addEventListener("click", () => showPane("settings", true));
for (const key of ["targetLanguage", "apiEndpoint", "apiKey", "model", "macosVisionHostName", "iosOcrEndpoint"]) elements[key].addEventListener("input", updateDraftState);
for (const key of ["alwaysAutoDetect", "triggerUsesAutoMode"]) elements[key].addEventListener("change", updateDraftState);
setBusy(false);

initialize().catch((error) => {
  showStatus(error.message, true);
});
