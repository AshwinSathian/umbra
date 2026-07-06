import { DEFAULT_STORED_THEME_SETTINGS, THEME_SETTINGS_KEY, type StoredThemeSettings } from "@umbra/shared";

const SLIDER_KEYS = [
  "backgroundLightness",
  "foregroundLightness",
  "contrastTarget",
  "brightness",
  "contrast",
  "sepia",
  "grayscale",
] as const satisfies readonly (keyof StoredThemeSettings)[];

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function getInputs(): Record<(typeof SLIDER_KEYS)[number], HTMLInputElement> {
  const result = {} as Record<(typeof SLIDER_KEYS)[number], HTMLInputElement>;
  for (const key of SLIDER_KEYS) {
    result[key] = document.getElementById(key) as HTMLInputElement;
  }
  return result;
}

function readFormValues(inputs: Record<string, HTMLInputElement>): StoredThemeSettings {
  const checkbox = document.getElementById("imageConservativeMode") as HTMLInputElement;
  const values: Record<string, number> = {};
  for (const key of SLIDER_KEYS) {
    values[key] = parseFloat(inputs[key]!.value);
  }
  return { ...(values as unknown as StoredThemeSettings), imageConservativeMode: checkbox.checked };
}

function applyToForm(settings: StoredThemeSettings, inputs: Record<string, HTMLInputElement>) {
  for (const key of SLIDER_KEYS) {
    inputs[key]!.value = String(settings[key]);
    const valueLabel = document.getElementById(`${key}-value`);
    if (valueLabel) valueLabel.textContent = String(settings[key]);
  }
  (document.getElementById("imageConservativeMode") as HTMLInputElement).checked = settings.imageConservativeMode;
}

async function broadcastSettingsChanged() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    chrome.tabs.sendMessage(tab.id, { type: "umbra:settings-changed" }).catch(() => {
      // No content script listening in this tab — expected for non-http(s) tabs.
    });
  }
}

function scheduleSave(inputs: Record<string, HTMLInputElement>) {
  const savedLabel = document.getElementById("saved")!;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const settings = readFormValues(inputs);
    await chrome.storage.local.set({ [THEME_SETTINGS_KEY]: settings });
    await broadcastSettingsChanged();
    savedLabel.style.opacity = "1";
    setTimeout(() => {
      savedLabel.style.opacity = "0";
    }, 1000);
  }, 300);
}

async function init() {
  const inputs = getInputs();
  const stored = await chrome.storage.local.get([THEME_SETTINGS_KEY]);
  const settings: StoredThemeSettings = {
    ...DEFAULT_STORED_THEME_SETTINGS,
    ...(stored[THEME_SETTINGS_KEY] as Partial<StoredThemeSettings>),
  };
  applyToForm(settings, inputs);

  for (const key of SLIDER_KEYS) {
    inputs[key]!.addEventListener("input", () => {
      const valueLabel = document.getElementById(`${key}-value`);
      if (valueLabel) valueLabel.textContent = inputs[key]!.value;
      scheduleSave(inputs);
    });
  }
  document
    .getElementById("imageConservativeMode")!
    .addEventListener("change", () => scheduleSave(inputs));

  document.getElementById("reset")!.addEventListener("click", () => {
    applyToForm(DEFAULT_STORED_THEME_SETTINGS, inputs);
    scheduleSave(inputs);
  });
}

void init();
