# Security Policy

Darkframe runs with broad host permissions (`http://*/*`, `https://*/*`) by necessity — recoloring
arbitrary pages requires reading their stylesheets, DOM, and images. That makes this
extension a meaningful place to report security issues responsibly.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a security vulnerability. Instead:

1. Open a [private security advisory](../../security/advisories/new) on this repository (GitHub's
   "Report a vulnerability" flow under the Security tab), or
2. If that isn't available to you, email the maintainer directly with a description of the
   issue, the affected file(s)/version, and — if possible — a proof-of-concept.

Please include:

- A clear description of the vulnerability and its impact.
- Steps to reproduce, or a minimal proof-of-concept page/extension state.
- The affected version/commit.

## What's in scope

- The Chrome MV3 extension (`packages/ext-chrome`) and the shared engine (`packages/core`,
  `packages/shared`) it depends on.
- The Safari Web Extension (`packages/ext-safari`).
- Anything that could let a visited web page escalate beyond what a normal page can do (e.g.
  reach the extension's privileged background context, inject unintended CSS/script, exfiltrate
  data, or abuse the extension's host permissions against internal/private network addresses).

## What's out of scope

- Denial-of-service / resource-exhaustion reports without a concrete security impact.
- Reports about third-party dependencies' known CVEs (please report those upstream; PRs
  bumping a dependency version are still welcome here).
- Issues that require physical access to an already-compromised machine.

## Response

This is a solo-maintained open-source project — response times are best-effort, not
SLA-backed. Confirmed vulnerabilities will be fixed and disclosed via a GitHub Security
Advisory and a new release; credit will be given unless you ask not to be named.
