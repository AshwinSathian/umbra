// Typed messaging protocol shared by the Chrome and Safari extension shells.
// Both platforms' background/content-script message passing implements this
// same shape so packages/core never needs to branch on platform.

export type FetchCssRequest = {
  type: "darkframe:fetch-css";
  url: string;
};

export type FetchCssResponse = {
  type: "darkframe:fetch-css-result";
  url: string;
  cssText: string | null;
  error: string | null;
};

export type ToggleRequest = {
  type: "darkframe:toggle";
  origin: string;
  enabled: boolean;
};

export type DarkframeMessage = FetchCssRequest | FetchCssResponse | ToggleRequest;
