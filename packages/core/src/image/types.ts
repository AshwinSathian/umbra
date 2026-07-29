/** RGBA pixel buffer, row-major, 4 bytes per pixel — the same shape
 * `ImageData.data` / `OffscreenCanvasRenderingContext2D.getImageData` produce,
 * so the browser-side adapter (extract-browser.ts) needs no conversion.
 *
 * `width`/`height` are the *analysis* grid's dimensions — the real sampler
 * (extract-browser.ts) always downsamples to at most 32px on the long edge
 * before classification, since the classifier only needs coarse structure.
 * `naturalWidth`/`naturalHeight`, when supplied, are the source image's real
 * decoded size *before* that downsampling — the only signal that lets the
 * classifier tell a small icon from a large banner apart (see classify.ts's
 * MAX_FLAT_RECOLOR_DIMENSION gate). Optional and falls back to `width`/
 * `height` in classify.ts so callers that don't downsample (all existing
 * unit tests, which build a grid directly at whatever resolution they want)
 * keep working unchanged — for those, natural size and analysis size are the
 * same thing by construction. */
export type PixelGrid = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  naturalWidth?: number;
  naturalHeight?: number;
};
