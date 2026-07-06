export const GLOBAL_ENABLED_KEY = "umbra:enabledGlobally";

export function siteOverrideKey(origin: string): string {
  return `umbra:site:${origin}`;
}

export type SiteOverride = "force-on" | "force-off" | "default";

export function resolveEnabled(globallyEnabled: boolean, override: SiteOverride | undefined): boolean {
  if (override === "force-on") return true;
  if (override === "force-off") return false;
  return globallyEnabled;
}
