export const STORAGE_KEY = "translect.settings";

export const DEFAULT_SETTINGS = {
  apiEndpoint: "https://api.openai.com/v1",
  apiKey: "",
  iosOcrEndpoint: "http://127.0.0.1:8000/upload",
  model: "gpt-5.4-mini",
  targetLanguage: "Traditional Chinese",
  alwaysAutoDetect: false,
  triggerUsesAutoMode: false,
  useIosOcrServer: false
};

export const MESSAGE_TYPES = {
  CAPTURE_VISIBLE_TAB: "capture-visible-tab",
  CLEAR_OVERLAYS: "clear-overlays",
  DISPATCH_ACTIVE_TAB: "dispatch-active-tab",
  GET_COMMANDS: "get-commands",
  GET_SETTINGS: "get-settings",
  SAVE_SETTINGS: "save-settings",
  SETTINGS_UPDATED: "settings-updated",
  TOGGLE_ALWAYS_AUTO_DETECT: "toggle-always-auto-detect",
  TRANSLATE_REGION: "translate-region",
  TRANSLATE_REGIONS: "translate-regions"
};

export const PAGE_ACTIONS = {
  AUTO_TRANSLATE_VISIBLE: "auto-translate-visible",
  CLEAR_OVERLAYS: "clear-overlays",
  SETTINGS_UPDATED: "settings-updated",
  START_MANUAL_SELECTION: "start-manual-selection"
};

export const COMMANDS = {
  ACTIVATE_TRANSLATION: "activate-translation",
  TOGGLE_ALWAYS_AUTO_DETECT: "toggle-always-auto-detect"
};
