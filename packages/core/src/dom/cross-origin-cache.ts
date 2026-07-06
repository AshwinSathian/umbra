import { discoverStylesheets } from "./style-discovery.js";

/** Fetches the raw CSS text at `url`, or null on any failure. The real
 * implementation is a message round-trip to the background script (a
 * content script's own `fetch` is subject to the page's CSP, which often
 * blocks it; the background script's fetch is not) — see
 * packages/ext-chrome/src/background/service-worker.ts. Tests inject a
 * synthetic fetcher instead. */
export type CssFetcher = (url: string) => Promise<string | null>;

const cache = new Map<string, CSSStyleSheet>();

/**
 * Finds every cross-origin `<link>` stylesheet on the page whose rules
 * couldn't be read directly (see style-discovery.ts's `corsBlocked` flag),
 * fetches its CSS text via `fetchCss`, and parses it into a detached
 * `CSSStyleSheet` via `replaceSync` — cached by URL so repeated theme
 * recomputation (on every mutation batch) doesn't refetch unchanged
 * sheets. A sheet whose fetch fails, or whose text fails to parse, is
 * simply left uncached and therefore untouched by theming — never guessed
 * at or assumed empty/opaque.
 *
 * Capped at {@link MAX_CORS_HOSTS} distinct hosts per page, matching Dark
 * Reader's own network.ts cap: pages that pull stylesheets from many
 * third-party origins (ad tech, widget embeds) are a real but rare case,
 * and an unbounded fan-out of network requests from a content script is
 * a real performance/privacy footgun worth capping deliberately rather
 * than discovering the hard way.
 */
const MAX_CORS_HOSTS = 16;

export async function warmCrossOriginSheetCache(doc: Document, fetchCss: CssFetcher): Promise<boolean> {
  const seenHosts = new Set<string>();
  let changed = false;

  for (const discovered of discoverStylesheets(doc)) {
    if (!discovered.corsBlocked || !discovered.href || cache.has(discovered.href)) continue;

    let host: string;
    try {
      host = new URL(discovered.href).host;
    } catch {
      continue;
    }
    if (!seenHosts.has(host)) {
      if (seenHosts.size >= MAX_CORS_HOSTS) continue;
      seenHosts.add(host);
    }

    const cssText = await fetchCss(discovered.href);
    if (!cssText) continue;

    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(cssText);
      cache.set(discovered.href, sheet);
      changed = true;
    } catch {
      // Malformed CSS, or replaceSync unsupported on this engine — leave
      // uncached; the sheet stays untouched rather than half-applied.
    }
  }

  return changed;
}

export function getCachedCrossOriginSheet(href: string): CSSStyleSheet | undefined {
  return cache.get(href);
}

/** Test-only: clears the module-level cache between test cases. */
export function clearCrossOriginSheetCache(): void {
  cache.clear();
}
