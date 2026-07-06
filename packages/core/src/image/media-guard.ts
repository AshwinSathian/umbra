const PROTECTED_TAG_NAMES = new Set(["video", "canvas", "audio"]);

/**
 * Elements that must never be touched by any recoloring path, unconditionally,
 * regardless of classification, settings, or conservative mode. `<video>` and
 * `<canvas>` are the two the hard "never alter media" requirement names
 * explicitly; `<audio>` has no visual content but is excluded too since it
 * can render native controls. This is intentionally a simple, unconditional
 * tag-name check — not a heuristic — because this specific guarantee must
 * never depend on a classifier being right.
 */
export function isProtectedMediaElement(el: Element): boolean {
  return PROTECTED_TAG_NAMES.has(el.tagName.toLowerCase());
}
