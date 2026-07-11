export type NativeDarkResult = {
  isNativeDark: boolean;
  /** How the result was determined — useful for tests/debugging, and to
   * confirm the cheap checks short-circuit before any expensive sampling. */
  method: "color-scheme-meta" | "color-scheme-style" | "media-query" | "none";
};

/**
 * Detects whether a page has already shipped its own dark theme, so Darkframe
 * can back off entirely rather than double-theming it. Checks are ordered
 * cheapest-first and short-circuit — the `<meta>`/computed-style checks
 * never need to touch layout, and a full-page sampling fallback (as Dark
 * Reader's grid-based detector uses) is deliberately not implemented in v1;
 * pages that don't declare `color-scheme` are treated as light and themed
 * normally, which is the safe default (a false "not native dark" only
 * results in normal theming, never in a skipped page).
 */
export function detectNativeDark(doc: Document, win: Window = doc.defaultView as Window): NativeDarkResult {
  const meta = doc.querySelector('meta[name="color-scheme"]');
  const metaContent = meta?.getAttribute("content") ?? "";
  if (/\bdark\b/i.test(metaContent) && !/\blight\b/i.test(metaContent)) {
    return { isNativeDark: true, method: "color-scheme-meta" };
  }

  const rootStyle = win.getComputedStyle(doc.documentElement);
  const colorScheme = rootStyle.getPropertyValue("color-scheme").trim();
  if (/\bdark\b/i.test(colorScheme) && !/\blight\b/i.test(colorScheme)) {
    return { isNativeDark: true, method: "color-scheme-style" };
  }

  if (win.matchMedia && win.matchMedia("(prefers-color-scheme: dark)").matches && colorScheme.includes("dark")) {
    return { isNativeDark: true, method: "media-query" };
  }

  return { isNativeDark: false, method: "none" };
}
