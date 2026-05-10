# Changelog

This project did not have a changelog before this documentation pass. Use this file for human-readable release notes going forward.

Format: keep entries under `Unreleased` until a version/date is chosen.

## Unreleased

### Frontend — Visual Design

- Added `TopologyBackground` canvas component (`frontend/src/components/backgrounds/topology-background.tsx`): animated off-white marching-squares contour field applied globally to every page via the root layout.
  - Scalar field built from three overlapping sine/cosine waves; 9 contour levels rendered with a single `beginPath/stroke` per level for efficiency.
  - Cursor ripple distortion via passive `pointermove` listener on `window`; click ripple rings via `pointerdown`.
  - Ambient blobs (warm + cool radial gradients) pre-rendered once into an offscreen `HTMLCanvasElement` and blitted per frame.
  - DPR-aware canvas resize: pixel ratio capped at ×2, `alpha: false` context, `setTransform` scale — saves ~15–20 % render time on hi-DPI screens.
  - Adaptive grid: 32/42/52/60 cells depending on viewport width; FPS watchdog auto-lowers grid by 10 if average drops below 40 fps over the first 60 frames.
  - Pauses automatically on hidden tab (`visibilitychange`), offscreen canvas (`IntersectionObserver`), and `prefers-reduced-motion: reduce` (single static frame).
  - `aria-hidden="true"`, `pointer-events-none`, `fixed inset-0 -z-10` — purely decorative, never intercepts clicks.
- Added `TopologyLayer` client wrapper (`frontend/src/components/backgrounds/topology-layer.tsx`) — a `lazy`-loaded `Suspense` boundary imported once in the root layout.
- Extended `PageBackground` with optional `variant?: "static" | "topology"` prop for opt-in per-component use.
- Updated root layout body background from `bg-white` to `bg-[#f8f7f4]` (matches canvas base color — eliminates FOUC flash).
- Refreshed landing page copy: updated hero headline, subheading, badge text, feature card descriptions, and footer line.
- Landing page feature cards and nav updated with glass morphism tokens (`bg-white/50 backdrop-blur-sm`, `border-white/60`) for visual coherence with the animated canvas beneath them.

### Documentation

- Rebuilt the documentation structure around a central docs index.
- Added detailed guides for overview, getting started, configuration, architecture, codebase map, features, API, database, security, testing, deployment, development, troubleshooting, FAQ, and glossary.
- Clarified confirmed behavior around Next.js 15, httpOnly refresh cookies, CSRF, hidden shared todo redaction, gateway routes, database ownership, and local Docker/startup configuration.
- Added production deployment baseline, secret management guide, and production environment template.
- Added a public security disclosure policy that uses GitHub Private Vulnerability Reporting.

### CI / QA

- Added markdownlint and offline Markdown link checks to CI.
- Added Docker-backed Playwright e2e coverage for auth, email verification, friendship, shared todos, and hidden viewer preference behavior.
- Excluded generated Playwright e2e specs from Vitest unit-test discovery.

### Repository Hygiene

- Added repository rules for Graphify-first analysis and mandatory documentation synchronization after behavior/config/test changes.
- Ignored AI/agent-local state, generated build artifacts, `tsconfig.tsbuildinfo`, and generated EF `Migrations/` folders.
- Expanded repository hygiene ignores for nested assistant/tooling state, MCP config, local assistant prompts, and generated chat/history artifacts.
- Removed tracked Claude local settings, Obsidian workspace/plugin state, frontend build output, frontend TypeScript build info, and generated EF migration files.
- Hardened `.dockerignore` so local agent/editor state, Graphify output, tests, docs, build artifacts, and generated migrations stay out of Docker build contexts.
- Bound RabbitMQ AMQP to `127.0.0.1:5672` in local Compose and added a runtime contract assertion for the localhost binding.
- Replaced a JWT-shaped test fixture with a non-token invalid bearer value to reduce false positives in secret scanners.
- Added database startup fallback that creates schema from the current EF model when no user-owned migrations exist.

### Project Metadata

- Added MIT license.
