/** RGBA pixel buffer, row-major, 4 bytes per pixel — the same shape
 * `ImageData.data` / `OffscreenCanvasRenderingContext2D.getImageData` produce,
 * so the browser-side adapter (extract-browser.ts) needs no conversion. */
export type PixelGrid = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};
