import type { FetchCssRequest } from "@darkframe/shared";
import { GLOBAL_ENABLED_KEY, isFetchableCssUrl, siteOverrideKey } from "@darkframe/shared";

type SetEnabledMessage = {
  type: "darkframe:set-enabled";
  origin: string;
  enabled: boolean;
  scope: "site" | "global";
};

type GetStateMessage = { type: "darkframe:get-state"; origin: string };

chrome.runtime.onMessage.addListener(
  (message: SetEnabledMessage | GetStateMessage | FetchCssRequest, _sender, sendResponse) => {
    if (message.type === "darkframe:fetch-css") {
      // Fetched from the background script, not the content script: a
      // page's own Content-Security-Policy can block a content script's
      // fetch of a third-party stylesheet URL, but the extension's own
      // background context is not subject to that page's CSP — the same
      // reason Dark Reader proxies cross-origin CSS fetches through its
      // background page. That same elevated context is exactly why the
      // URL must be validated before fetching: this fetch runs with the
      // extension's broad host_permissions (a CORS bypass ordinary page
      // script doesn't have), so an unvalidated URL would let any visited
      // page use this handler to probe internal/loopback/link-local
      // addresses via a hidden cross-origin <link>. See
      // packages/shared/src/url-safety.ts for what's blocked and why.
      if (!isFetchableCssUrl(message.url)) {
        sendResponse({ cssText: null, error: "blocked: unsafe or non-public URL" });
        return true;
      }

      fetch(message.url)
        .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((cssText) => sendResponse({ cssText, error: null }))
        .catch((err: unknown) => sendResponse({ cssText: null, error: String(err) }));
      return true;
    }

    if (message.type === "darkframe:get-state") {
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

    if (message.type === "darkframe:set-enabled") {
      const update =
        message.scope === "global"
          ? { [GLOBAL_ENABLED_KEY]: message.enabled }
          : { [siteOverrideKey(message.origin)]: message.enabled ? "force-on" : "force-off" };

      void chrome.storage.local.set(update).then(async () => {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (tab.id === undefined) continue;
          chrome.tabs
            .sendMessage(tab.id, { type: "darkframe:toggle", origin: message.origin, enabled: message.enabled })
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
