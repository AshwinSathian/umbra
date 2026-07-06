/**
 * Guards the one place this codebase makes a network request on a
 * page-supplied URL: the background script's cross-origin CSS fetch (see
 * packages/ext-chrome/src/background/service-worker.ts and
 * packages/core/src/dom/cross-origin-cache.ts). That fetch runs with the
 * extension's own broad `host_permissions`, which grants it a CORS bypass
 * ordinary page script does not have — so without this check, any visited
 * page could embed a hidden cross-origin `<link rel="stylesheet">`
 * pointing at an internal address (loopback, RFC 1918 ranges, or a
 * link-local/cloud-metadata address like 169.254.169.254) and use the
 * extension's elevated background context to read back the response body.
 *
 * This is a literal-based check: it blocks IP-literal loopback/private/
 * link-local addresses and `localhost`, plus any non-http(s) scheme. It
 * does **not** protect against DNS rebinding (a hostname that resolves to
 * a private address at fetch time) — no DNS-resolution-aware blocking is
 * available to a browser extension's JavaScript, which never sees
 * resolved IPs. That residual gap is accepted and documented rather than
 * silently ignored; closing it fully would require a server-side proxy.
 */
export function isFetchableCssUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return false;
  }

  if (isPrivateOrLoopbackIPv6(hostname)) {
    return false;
  }

  const ipv4 = parseIPv4(hostname);
  if (ipv4 && isPrivateOrLoopbackIPv4(ipv4)) {
    return false;
  }

  return true;
}

function parseIPv4(hostname: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return null;
  const parts = [match[1]!, match[2]!, match[3]!, match[4]!].map(Number);
  if (parts.some((p) => p > 255)) return null;
  return parts as [number, number, number, number];
}

function isPrivateOrLoopbackIPv4([a, b]: [number, number, number, number]): boolean {
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local, incl. cloud metadata 169.254.169.254)
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

function isPrivateOrLoopbackIPv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (normalized === "::1") return true; // loopback
  if (normalized === "::") return true; // unspecified
  if (/^fe80:/i.test(normalized)) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/i.test(normalized)) return true; // fc00::/7 unique local
  return false;
}
