# Contributing to Darkframe

Thanks for considering contributing. This is a small, solo-maintained project, so please
keep pull requests focused — small, reviewable changes get merged much faster than large
ones.

## Getting started

```sh
pnpm install
pnpm build       # builds all packages, including syncing the Safari resources
pnpm test        # 119+ unit tests across packages/core and packages/shared
pnpm lint
pnpm typecheck
```

To run the Chrome extension locally, see [README.md](./README.md#running-the-chrome-extension-locally).
To run the Safari extension locally, see [README.md](./README.md#running-the-safari-extension-locally-macos-free--no-apple-developer-account-required).

## Before opening a PR

- Run `pnpm lint && pnpm typecheck && pnpm test` locally — CI runs the same checks and will
  fail the same way.
- Add tests for any new behavior. Every module in `packages/core` has a colocated
  `*.test.ts` file; follow that pattern.
- If your change affects the Chrome extension's runtime behavior, re-run
  `node tests/e2e/verify-extension.mjs` locally (requires a real display — it loads the
  actual built extension into a real Chromium instance via Playwright) and paste its output
  into the PR description.
- Update [PLAN-darkframe.md](./PLAN-darkframe.md) if your change affects the documented architecture,
  adds/removes a phase task, or fixes a bug worth recording for posterity — this file is the
  project's running design log, not just an initial planning doc.

## Code style

- TypeScript strict mode, no `any`/`as any`/`@ts-ignore` without a very good reason (there
  are currently zero in the codebase — let's keep it that way).
- Prettier + ESLint are enforced in CI (`pnpm lint`). Run `pnpm format` locally if unsure.
- Comments should explain *why*, not *what* — see the existing codebase for the intended
  tone. Don't add comments that just restate the code.

## Reporting bugs / requesting features

Open a GitHub issue. For security vulnerabilities, see [SECURITY.md](./SECURITY.md) instead
— please don't open a public issue for those.

## License

By contributing, you agree that your contributions will be licensed under the project's
[MIT License](./LICENSE).
