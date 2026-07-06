import { getAllStyleRoots } from "./style-discovery.js";

/**
 * Finds every element with a non-empty `style` attribute, across the
 * document and every shadow root. Inline styles are extremely common in
 * the wild (WYSIWYG editor output, email-style templates, many third-party
 * widgets) and were, before this module existed, entirely invisible to the
 * theme engine — it only ever walked stylesheet rules, never an element's
 * own `style=""` attribute.
 */
export function findInlineStyledElements(doc: Document): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const root of getAllStyleRoots(doc)) {
    const elements = root.querySelectorAll<HTMLElement>("[style]");
    for (const el of elements) {
      if (el.style.length > 0) {
        found.push(el);
      }
    }
  }
  return found;
}
