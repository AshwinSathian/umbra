// Typed messaging protocol shared by the Chrome and Safari extension shells.
// Both platforms' background/content-script message passing implements this
// same shape so packages/core never needs to branch on platform.

export type FetchCssRequest = {
  type: "umbra:fetch-css";
  url: string;
};

export type FetchCssResponse = {
  type: "umbra:fetch-css-result";
  url: string;
  cssText: string | null;
  error: string | null;
};

export type ToggleRequest = {
  type: "umbra:toggle";
  origin: string;
  enabled: boolean;
};

export type UmbraMessage = FetchCssRequest | FetchCssResponse | ToggleRequest;
