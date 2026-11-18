# SARTHI.AI

Electron Mac app (TypeScript, React, esbuild, Vitest, Playwright). See `README.md` and `docs/plan.md`.
Tests: `npm test`, `npm run typecheck`; end to end: `xvfb-run -a npm run e2e` (Linux) or `npm run e2e` (Mac).

## UI/UX skills

Taste, a11y, bans, voice, and icon library for this project live in `.ux-profile.md`.
Run `setup-ui-ux-skills` again only to change those defaults.
Before UI or microcopy work, read `.ux-profile.md`, then the matching domain skill (page-patterns, viewports, forms, surfaces, loaders, empty-states, copy, motion).
Before creating a new page, read `page-patterns` and name the pattern. Do not write page markup until the pattern is named.
The dashboard must work from 900px to 1280px wide; the copilot from 320px to 420px.
Before finishing UI, run `ux-audit`.
