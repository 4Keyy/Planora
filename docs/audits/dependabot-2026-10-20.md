# Dependabot Integration Review — 2026-10-20

All eight open Dependabot pull requests were reviewed and integrated into `main`.
The pre-integration baseline was `af93e08`. Merging through GitHub's API is blocked
by the owner's local agent policy, so on the owner's instruction each reviewed change
was applied as a direct commit on `main` (linear history, equivalent to the
repository's squash-only merge setting) and the pull request was then closed with a
link to that commit. Closing removed each Dependabot head branch.

## Integrated requests

| Request | Reviewed change | Commit on main |
|---|---|---|
| [#125](https://github.com/4Keyy/Planora/pull/125) | lychee-action 2.8.0 → 2.9.0 | `5f2f033` |
| [#129](https://github.com/4Keyy/Planora/pull/129) | setup-dotnet 5.4.0 → 6.0.0, seven uses in five workflows | `2a4a875` |
| [#128](https://github.com/4Keyy/Planora/pull/128) | codeql-action/upload-sarif 4.36.3 → 4.38.3 | `ef8dba9` |
| [#126](https://github.com/4Keyy/Planora/pull/126) | codeql-action/analyze 4.36.3 → 4.38.3 | `e851fe9` |
| [#127](https://github.com/4Keyy/Planora/pull/127) | markdownlint-cli2-action 24.0.0 → 24.2.0 (three-way apply next to #125) | `2ad6ae3` |
| — | CodeQL init pinned to the same 4.38.3 commit as analyze and upload-sarif | `5c2f6ed` |
| — | Frontend CI, E2E and security jobs on Node 22 | `a047ad5` |
| [#133](https://github.com/4Keyy/Planora/pull/133), [#131](https://github.com/4Keyy/Planora/pull/131), [#132](https://github.com/4Keyy/Planora/pull/132) | Frontend patch/minor group, jest-dom 7.0.1, Vitest 5.0.5 with V8 coverage 5.0.5 | the `build(deps)` commit that adds this review |

Each action revision was resolved from its upstream release tag, dereferencing
annotated tags. Workflow permissions, job commands, inputs and scanner thresholds
were not changed by the action updates.

| Action release | Immutable commit used in workflows |
|---|---|
| lycheeverse/lychee-action 2.9.0 | `e7477775783ea5526144ba13e8db5eec57747ce8` |
| DavidAnson/markdownlint-cli2-action 24.2.0 | `21c1be1b93ad9ed58fa840aacc3f279cde2a72ff` |
| actions/setup-dotnet 6.0.0 | `a98b56852c35b8e3190ac28c8c2271da59106c68` |
| github/codeql-action 4.38.3 (init, analyze, upload-sarif) | `24c54180a607b1449ed407dd24f251e4e9147c8d` |

setup-dotnet 6.0.0 only migrates the action to ESM and refreshes its own
dependencies; the `dotnet-version` and `cache` inputs used here are unchanged.
Dependabot opened no PR for `codeql-action/init`; without the alignment commit
init would run 4.36.3 against a 4.38.3 analyze, the mismatch that failed both
CodeQL jobs on #126.

## Frontend dependency graph

The three npm requests were combined into one commit because they edit the same
lockfile and #132 cannot install on its own: Vitest 5.0.5 conflicts with the
4.1.11 V8 coverage provider (`ERESOLVE`), so `@vitest/coverage-v8` moves to 5.0.5
with it. Updated versions: Next.js and eslint-config-next 16.4.2, Radix Dropdown
Menu 2.2.1 and Popover 1.3.1 (Slot 1.5.0 in the lockfile), react-hook-form 7.90.0,
Playwright 1.64.1, user-event 14.6.8, beasties 0.5.5, postcss 8.5.30 (direct pin
and override), jest-dom 7.0.1, Vitest 5.0.5. React/React DOM 18.3.1, Tailwind 3.4
and framer-motion 11 are unchanged.

Lockfile comparison against the baseline: 15 entries removed (Vitest 4 internals
such as `@vitest/runner` and the istanbul report helpers), 2 added
(`@vitest/istanbul-lib-*`), 46 version changes, no version decreases, and all 56
Linux/macOS optional platform entries (SWC, sharp) preserved alongside Windows.

Two test-infrastructure adjustments were required; no application source changed:

- `src/test/setup.ts` imports `@testing-library/jest-dom/vitest`. The root entry
  augments only the global `jest` namespace, which Vitest 5 no longer inherits, so
  1,072 matcher type errors appeared in `tsc` until the setup used the Vitest entry.
- Vitest 5 enables `clearMocks` by default. `auth-public.test.ts` asserted the
  `axios.create` call made at module import inside a test; it now captures those
  options at module scope and keeps the same assertion.

Vitest 5 and jest-dom 7 require Node 22, so the frontend CI jobs moved from the
end-of-life Node 20 to Node 22 in a separate commit before this one.

## Verification

Checks ran in an isolated copy of the tree (`git archive` of `main` plus the
candidate manifests), on Windows with Node 22.18.0 and npm 10.9.3.

| Check | Result |
|---|---|
| `npm install` from the baseline lockfile | Resolved without errors |
| ESLint (`npm run lint`) | Passed |
| TypeScript (`npm run type-check`) | Passed after the setup change above |
| Vitest with V8 coverage | 142 files, 1,881 tests passed; statements 93.78%, branches 86.56%, functions 94.27%, lines 95.67%; all 85% gates passed |
| Next.js production build | Passed on Next.js 16.4.2 (Turbopack), 15 app routes |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm audit` (full graph) | 7 high / 3 moderate, all in the development tool graph (braces chain under eslint-config-next and Tailwind 3, postcss-selector-parser); unchanged from the accepted 2026-10-06 baseline, no non-major fix available |

The build reports two deprecations that do not fail it: React 18 support is
deprecated in Next.js 16 and will be removed in Next.js 17, and the `middleware`
file convention is deprecated in favour of `proxy`. Both are tracked in the
[frontend audit](frontend-2026-10-20/README.md) (FE-25, FE-27) rather than changed here.

Not executed: Playwright E2E (needs the Docker stack) and backend tests (backend
source and packages are untouched by these requests).

## Repository state after integration

- Open pull requests: none. Remote branches: `main` and `security/nuget-vuln-tracking`.
- `security/nuget-vuln-tracking` is maintained by `.github/workflows/nuget-vuln-pr.yml`
  and was intentionally kept: the workflow reuses that branch name for its tracking
  report and would recreate it. It holds no source changes. The workflow has failed
  every night since 2026-10-14 because its `dotnet restore` step treats NU1903 as an
  error exactly when vulnerable packages exist, and repository settings do not allow
  GitHub Actions to create pull requests, so the tracking PR is never opened.
- The Security Scan on `main` stays red for two pre-existing reasons: the
  development-graph npm audit above and `dotnet-vuln` reporting MessagePack 2.5.302
  (GHSA-qhrr-8q5h-9q3h, moderate, fixed in 2.5.303 on the same 2.5 line).
- Branch protection on `main` requires linear history and conversation resolution
  but has no required status checks, does not apply to administrators, and allows
  force pushes. These are recorded as owner decisions in the frontend audit.
