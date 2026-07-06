import type { FetchCssRequest } from "@umbra/shared";
import { GLOBAL_ENABLED_KEY, siteOverrideKey } from "@umbra/shared";

type SetEnabledMessage = {
  type: "umbra:set-enabled";
  origin: string;
  enabled: boolean;
  scope: "site" | "global";
};

type GetStateMessage = { type: "umbra:get-state"; origin: string };

chrome.runtime.onMessage.addListener(
  (message: SetEnabledMessage | GetStateMessage | FetchCssRequest, _sender, sendResponse) => {
    if (message.type === "umbra:fetch-css") {
      // Fetched from the background script, not the content script: a
      // page's own Content-Security-Policy can block a content script's
      // fetch of a third-party stylesheet URL, but the extension's own
      // background context is not subject to that page's CSP — the same
      // reason Dark Reader proxies cross-origin CSS fetches through its
      // background page.
      fetch(message.url)
        .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((cssText) => sendResponse({ cssText, error: null }))
        .catch((err: unknown) => sendResponse({ cssText: null, error: String(err) }));
      return true;
    }

    if (message.type === "umbra:get-state") {
      void chrome.storage.local
        .get([GLOBAL_ENABLED_KEY, siteOverrideKey(message.origin)])
        .then((stored) => {
          sendResponse({
            globallyEnabled: stored[GLOBAL_ENABLED_KEY] !== false,
            siteOverride: stored[siteOverrideKey(message.origin)] ?? "default",
          });
        });
      return true;
    }

    if (message.type === "umbra:set-enabled") {
      const update =
        message.scope === "global"
          ? { [GLOBAL_ENABLED_KEY]: message.enabled }
          : { [siteOverrideKey(message.origin)]: message.enabled ? "force-on" : "force-off" };

      void chrome.storage.local.set(update).then(async () => {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (tab.id === undefined) continue;
          chrome.tabs
            .sendMessage(tab.id, { type: "umbra:toggle", origin: message.origin, enabled: message.enabled })
            .catch(() => {
              // No content script listening in this tab (e.g. a chrome:// page) — expected, not an error.
            });
        }
        sendResponse({ ok: true });
      });
      return true;
    }

    return false;
  },
);
