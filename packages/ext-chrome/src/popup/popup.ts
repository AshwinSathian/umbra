import {
  DEFAULT_STORED_THEME_SETTINGS,
  THEME_SETTINGS_KEY,
  type StoredThemeSettings,
} from "@darkframe/shared";

type GetStateResponse = { globallyEnabled: boolean; siteOverride: "force-on" | "force-off" | "default" };

const QUICK_SLIDER_KEYS = ["brightness", "contrast", "backgroundLightness"] as const satisfies readonly (keyof StoredThemeSettings)[];

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function setSwitch(button: HTMLButtonElement, checked: boolean): void {
  button.setAttribute("aria-checked", String(checked));
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

function originOf(tab: chrome.tabs.Tab): string | null {
  if (!tab.url) return null;
  try {
    return new URL(tab.url).origin;
  } catch {
    return null;
  }
}

/** Debounced storage write + cross-tab broadcast, mirroring options.ts so a
 * change made from either surface is saved and picked up identically. */
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSettingsSave(settings: StoredThemeSettings): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await chrome.storage.local.set({ [THEME_SETTINGS_KEY]: settings });
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      chrome.tabs.sendMessage(tab.id, { type: "darkframe:settings-changed" }).catch(() => {
        // No content script listening in this tab — expected for non-http(s) tabs.
      });
    }
  }, 250);
}

async function readStoredThemeSettings(): Promise<StoredThemeSettings> {
  const stored = await chrome.storage.local.get([THEME_SETTINGS_KEY]);
  return { ...DEFAULT_STORED_THEME_SETTINGS, ...(stored[THEME_SETTINGS_KEY] as Partial<StoredThemeSettings>) };
}

async function init() {
  const statusPill = byId<HTMLDivElement>("status-pill");
  const statusWord = byId<HTMLSpanElement>("status-word");
  const originLine = byId<HTMLDivElement>("origin-line");
  const unavailable = byId<HTMLDivElement>("unavailable");
  const controls = byId<HTMLDivElement>("controls");
  const siteToggle = byId<HTMLButtonElement>("site-toggle");
  const siteToggleSublabel = byId<HTMLDivElement>("site-toggle-sublabel");
  const globalToggle = byId<HTMLButtonElement>("global-toggle");
  const conservativeToggle = byId<HTMLButtonElement>("conservative-toggle");
  const openOptions = byId<HTMLButtonElement>("open-options");

  openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());

  const tab = await getActiveTab();
  const origin = tab ? originOf(tab) : null;

  if (!origin || tab?.id === undefined) {
    unavailable.hidden = false;
    controls.hidden = true;
    originLine.textContent = "no active page";
    return;
  }

  originLine.textContent = origin.replace(/^https?:\/\//, "");

  function renderEnabled(effectivelyEnabled: boolean) {
    statusPill.dataset.active = String(effectivelyEnabled);
    statusWord.textContent = effectivelyEnabled ? "ON" : "OFF";
    setSwitch(siteToggle, effectivelyEnabled);
    siteToggleSublabel.textContent = effectivelyEnabled ? "On" : "Off";
  }

  async function refreshState(): Promise<{ effectivelyEnabled: boolean; globallyEnabled: boolean }> {
    const state = (await chrome.runtime.sendMessage({ type: "darkframe:get-state", origin })) as GetStateResponse;
    const effectivelyEnabled =
      state.siteOverride === "force-on" || (state.siteOverride === "default" && state.globallyEnabled);
    renderEnabled(effectivelyEnabled);
    setSwitch(globalToggle, state.globallyEnabled);
    return { effectivelyEnabled, globallyEnabled: state.globallyEnabled };
  }

  let { effectivelyEnabled, globallyEnabled } = await refreshState();

  siteToggle.addEventListener("click", async () => {
    effectivelyEnabled = !effectivelyEnabled;
    renderEnabled(effectivelyEnabled); // optimistic — feels instant, corrected below if the round-trip disagrees
    await chrome.runtime.sendMessage({
      type: "darkframe:set-enabled",
      origin,
      enabled: effectivelyEnabled,
      scope: "site",
    });
    ({ effectivelyEnabled, globallyEnabled } = await refreshState());
  });

  globalToggle.addEventListener("click", async () => {
    globallyEnabled = !globallyEnabled;
    setSwitch(globalToggle, globallyEnabled);
    await chrome.runtime.sendMessage({
      type: "darkframe:set-enabled",
      origin,
      enabled: globallyEnabled,
      scope: "global",
    });
    ({ effectivelyEnabled, globallyEnabled } = await refreshState());
  });

  // --- Inline tuning: same storage key + broadcast as the full options
  // page, so either surface stays in sync with the other. ---
  const settings = await readStoredThemeSettings();
  setSwitch(conservativeToggle, settings.imageConservativeMode);
  for (const key of QUICK_SLIDER_KEYS) {
    const input = byId<HTMLInputElement>(key);
    input.value = String(settings[key]);
    byId<HTMLSpanElement>(`${key}-value`).textContent = settings[key].toFixed(2);
  }

  conservativeToggle.addEventListener("click", async () => {
    settings.imageConservativeMode = !settings.imageConservativeMode;
    setSwitch(conservativeToggle, settings.imageConservativeMode);
    scheduleSettingsSave(settings);
  });

  for (const key of QUICK_SLIDER_KEYS) {
    const input = byId<HTMLInputElement>(key);
    input.addEventListener("input", () => {
      const value = parseFloat(input.value);
      settings[key] = value;
      byId<HTMLSpanElement>(`${key}-value`).textContent = value.toFixed(2);
      scheduleSettingsSave(settings);
    });
  }
}

void init();
