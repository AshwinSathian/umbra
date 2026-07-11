type GetStateResponse = { globallyEnabled: boolean; siteOverride: "force-on" | "force-off" | "default" };

async function getActiveTabOrigin(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return null;
  try {
    return new URL(tab.url).origin;
  } catch {
    return null;
  }
}

async function render() {
  const origin = await getActiveTabOrigin();
  const statusEl = document.getElementById("status")!;
  const siteButton = document.getElementById("site-toggle") as HTMLButtonElement;
  const globalButton = document.getElementById("global-toggle") as HTMLButtonElement;

  if (!origin) {
    statusEl.textContent = "Not available on this page.";
    siteButton.disabled = true;
    globalButton.disabled = true;
    return;
  }

  const state = (await chrome.runtime.sendMessage({ type: "darkframe:get-state", origin })) as GetStateResponse;
  const effectivelyEnabled =
    state.siteOverride === "force-on" || (state.siteOverride === "default" && state.globallyEnabled);

  statusEl.textContent = `${origin} — currently ${effectivelyEnabled ? "on" : "off"} (global: ${
    state.globallyEnabled ? "on" : "off"
  })`;

  siteButton.onclick = async () => {
    await chrome.runtime.sendMessage({
      type: "darkframe:set-enabled",
      origin,
      enabled: !effectivelyEnabled,
      scope: "site",
    });
    void render();
  };

  globalButton.onclick = async () => {
    await chrome.runtime.sendMessage({
      type: "darkframe:set-enabled",
      origin,
      enabled: !state.globallyEnabled,
      scope: "global",
    });
    void render();
  };
}

void render();
