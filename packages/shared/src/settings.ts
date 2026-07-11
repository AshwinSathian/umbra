export const THEME_SETTINGS_KEY = "darkframe:themeSettings";

export type StoredThemeSettings = {
  /** OKLCH lightness (0-1) most backgrounds settle near. */
  backgroundLightness: number;
  /** OKLCH lightness (0-1) most text settles near. */
  foregroundLightness: number;
  /** WCAG 2.1 contrast ratio text is guaranteed to meet. */
  contrastTarget: number;
  /** 1 = unchanged, <1 darker, >1 brighter. */
  brightness: number;
  /** 1 = unchanged, <1 flatter, >1 more contrast. */
  contrast: number;
  /** 0 = no sepia, 1 = fully toned toward sepia. */
  sepia: number;
  /** 0 = full color, 1 = fully desaturated. */
  grayscale: number;
  /** When true (default), images the classifier isn't confident about are
   * left untouched. When false, "uncertain" images are also recolored —
   * an informed, opt-in relaxation of the default fail-safe. */
  imageConservativeMode: boolean;
};

export const DEFAULT_STORED_THEME_SETTINGS: StoredThemeSettings = {
  backgroundLightness: 0.22,
  foregroundLightness: 0.78,
  contrastTarget: 4.5,
  brightness: 1,
  contrast: 1,
  sepia: 0,
  grayscale: 0,
  imageConservativeMode: true,
};
