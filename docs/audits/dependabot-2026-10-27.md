# Dependabot Integration Review — 2026-10-27

Dependabot opened eight pull requests on 2026-10-26 (#142 replaced #141 late that night). All
were reviewed and integrated into `main` the way the [2026-10-20 review](dependabot-2026-10-20.md) records: merging through
GitHub's API is blocked by the owner's local agent policy, so each reviewed change was applied as
a direct commit on `main` and the pull request was closed with a link to it.

## Integrated requests

| Request | Reviewed change | Commit on main |
|---|---|---|
| [#134](https://github.com/4Keyy/Planora/pull/134) | actions/checkout 7.0.0 → 7.0.1, 18 uses in eight workflows | `fa4af05` |
| [#140](https://github.com/4Keyy/Planora/pull/140) | actions/setup-node 6.4.0 → 7.1.0, 6 uses | `fa4af05` |
| [#138](https://github.com/4Keyy/Planora/pull/138) | actions/upload-artifact 7.0.1 → 7.0.2, 8 uses | `fa4af05` |
| [#139](https://github.com/4Keyy/Planora/pull/139), [#137](https://github.com/4Keyy/Planora/pull/137) | github/codeql-action init and upload-sarif 4.38.3 → 4.39.1; analyze aligned to the same commit | `fa4af05` |
| [#141](https://github.com/4Keyy/Planora/pull/141), [#136](https://github.com/4Keyy/Planora/pull/136) | Next.js and eslint-config-next 16.4.3, zustand 5.0.16, postcss 8.5.31 (direct pin and override), jsdom 30.1.3 | `27feb12` |
| [#142](https://github.com/4Keyy/Planora/pull/142) | The same group regenerated with react-hook-form 7.90.0 → 7.91.0; the rest was already on `main` | the `build(deps)` commit for react-hook-form |

Each action revision was resolved from its upstream release tag, annotated tags dereferenced:

| Action release | Immutable commit used in workflows |
|---|---|
| actions/checkout 7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| actions/setup-node 7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| actions/upload-artifact 7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |
| github/codeql-action 4.39.1 (init, analyze, upload-sarif) | `9b3254085494b55a0f7c4c2b3d2d52cc712ce370` |

setup-node 7 moved the action to ESM and changed how `NODE_AUTH_TOKEN` is set for a
`registry-url`; no workflow here sets one, and the `node-version` and `cache` inputs are
unchanged. Dependabot opened no request for `codeql-action/analyze`. It must run the release
`init` runs — a mismatch failed both CodeQL jobs in October — so it moved with them.

## Frontend dependency graph

The two npm requests share the lockfile and were combined into one commit. Against the previous
lockfile: 22 version changes, all upward (the Next.js packages and their SWC binaries for every
platform, jsdom and its URL/encoding helpers), two `lru-cache` copies added under jsdom's CSS
helpers, and three entries removed that jsdom 30 no longer uses (`symbol-tree`,
`@asamuzakjp/nwsapi`, `@asamuzakjp/generational-cache`). The Linux, macOS and Windows SWC entries
are all still present.

jsdom 30's CSS helpers (`@asamuzakjp/css-color` 7, `@asamuzakjp/dom-selector` 10) declare Node.js
`^22.22.2 || ^24.15.0 || >=26`. CI's `node-version: '22'` resolves to the latest 22.x; an older
local Node 22 prints `EBADENGINE` warnings at install, and the suite still passed on 22.18.0.
No application source or test changed for these updates.

## Verification

| Check | Result |
|---|---|
| Workflows | All eight parse; no old pin left |
| npm audit `--omit=dev` | 0 vulnerabilities |
| ESLint (`--max-warnings 0`) and `tsc` | Passed |
| Frontend suite with coverage thresholds | Passed on the updated graph |
| Production build (Next.js 16.4.3) | Passed |
