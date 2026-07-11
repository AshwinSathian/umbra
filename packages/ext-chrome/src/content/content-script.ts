import {
  type ApplyThemeOptions,
  type DisposeFn,
  DEFAULT_ADJUSTMENTS,
  DEFAULT_BACKGROUND_POLES,
  DEFAULT_FOREGROUND_POLES,
  applyTheme,
  sampleImageFromUrl,
} from "@darkframe/core";
import {
  DEFAULT_STORED_THEME_SETTINGS,
  GLOBAL_ENABLED_KEY,
  type SiteOverride,
  type StoredThemeSettings,
  THEME_SETTINGS_KEY,
  resolveEnabled,
  siteOverrideKey,
} from "@darkframe/shared";

let currentDispose: DisposeFn | null = null;

const POLE_SPREAD = DEFAULT_BACKGROUND_POLES.high - DEFAULT_BACKGROUND_POLES.low;

function toThemeOptions(stored: StoredThemeSettings): ApplyThemeOptions {
  return {
    settings: {
      backgroundPoles: {
        low: Math.max(0, stored.backgroundLightness - POLE_SPREAD),
        high: stored.backgroundLightness,
      },
      foregroundPoles: {
        low: stored.foregroundLightness,
        high: Math.min(1, stored.foregroundLightness + (DEFAULT_FOREGROUND_POLES.high - DEFAULT_FOREGROUND_POLES.low)),
      },
      contrastTarget: stored.contrastTarget,
      adjustments: {
        ...DEFAULT_ADJUSTMENTS,
        brightness: stored.brightness,
        contrast: stored.contrast,
        sepia: stored.sepia,
        grayscale: stored.grayscale,
      },
    },
    imageSampler: sampleImageFromUrl,
    imageConservativeMode: stored.imageConservativeMode,
    cssFetcher: fetchCssFromBackground,
  };
}

/** Cross-origin stylesheet text is fetched by the background script, not
 * here — a page's own CSP can block a content script's own fetch of a
 * third-party URL, but the background context is not subject to it. */
async function fetchCssFromBackground(url: string): Promise<string | null> {
  try {
    const response = (await chrome.runtime.sendMessage({ type: "darkframe:fetch-css", url })) as {
      cssText: string | null;
    };
    return response?.cssText ?? null;
  } catch {
    return null;
  }
}

async function readStoredThemeSettings(): Promise<StoredThemeSettings> {
  const stored = await chrome.storage.local.get([THEME_SETTINGS_KEY]);
  return { ...DEFAULT_STORED_THEME_SETTINGS, ...(stored[THEME_SETTINGS_KEY] as Partial<StoredThemeSettings>) };
}

async function start() {
  if (currentDispose) return;
  const themeSettings = await readStoredThemeSettings();
  if (currentDispose) return; // a concurrent start() won the race while we awaited storage
  currentDispose = applyTheme(document, window, toThemeOptions(themeSettings));
}

function stop() {
  currentDispose?.();
  currentDispose = null;
}

async function restart() {
  stop();
  await start();
}

async function readEnabledState(): Promise<boolean> {
  const origin = location.origin;
  const stored = await chrome.storage.local.get([GLOBAL_ENABLED_KEY, siteOverrideKey(origin)]);
  const globallyEnabled = stored[GLOBAL_ENABLED_KEY] !== false; // default true
  const override = stored[siteOverrideKey(origin)] as SiteOverride | undefined;
  return resolveEnabled(globallyEnabled, override);
}

async function init() {
  const enabled = await readEnabledState();
  if (enabled) await start();
}

chrome.runtime.onMessage.addListener((message: { type?: string; origin?: string; enabled?: boolean }) => {
  if (message?.type === "darkframe:settings-changed") {
    if (currentDispose) void restart();
    return;
  }
  if (message?.type !== "darkframe:toggle") return;
  if (message.origin !== undefined && message.origin !== location.origin) return;
  if (message.enabled) void start();
  else stop();
});

void init();
