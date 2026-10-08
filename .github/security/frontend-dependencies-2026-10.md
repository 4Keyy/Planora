# Frontend Dependency Review — 2026-10-06

The original [Dependabot PR #123](https://github.com/4Keyy/Planora/pull/123)
updates 18 direct dependencies. Its initial Next.js 16.3.5 version remained in
the affected range of [GHSA-vcvr-r3jv-pc5j](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j);
the advisory identifies 16.3.6 as the first patched release. The reviewed graph
uses Next.js and its matching ESLint configuration **16.3.8**, Vitest and V8
coverage **4.1.11**, and the undici override **7.30.0**. Compatible transitive
updates resolve sharp to **0.35.5** and source-map-js to **1.2.2**.

React/React DOM remain **18.3.1**, Tailwind remains **3.4.19**, and framer-motion
remains **11.18.2**. No frontend application source or unit tests were replaced.
The npm scripts are unchanged; the reviewed PostCSS override remains in place.
The lockfile retains Linux Next.js SWC and sharp packages as well as the Windows
packages used for local validation.

## Executed checks

| Check | Local result |
|---|---|
| Locked dependency installation | `npm ci` passed |
| ESLint / TypeScript | Passed |
| Frontend suite | 100 files; 1,231 tests passed |
| V8 statements / branches / functions / lines | 94.48% / 86.46% / 94.20% / 96.34%; all four 85% gates passed |
| Production Next.js build | Passed; 14 dynamic routes; isolated output and generated config edits cleaned up |
| Production dependency scan | `npm audit --omit=dev`: zero affected packages |
| Full dependency scan | 10 affected package entries: 7 high, 3 moderate; all in development dependencies |

Scanner results depend on registry metadata at the time of execution. The
production-only scan does not establish that build tools are irrelevant to
security, nor does a package finding prove an exploitable application path.

## Remaining advisories and merge limits

The high findings share the unpatched `braces` dependency through fast-glob,
micromatch, chokidar, Tailwind and Next.js ESLint tooling. The
[braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) affects the
published 3.0.3 release; the npm registry has no newer published braces release
at review time. The moderate findings cover postcss-selector-parser,
postcss-nested and dependent tailwindcss-animate. Forcing unrelated major
upgrades or downgrading ESLint/Next.js is outside a compatible patch update.

The existing `npm-audit` job retains its full-graph high-severity gate, so it
continues to fail. The fresh PR E2E run stopped before browser tests because
`planora_realtime` was absent. PR #106 also exposed pre-existing migration
artifact and OpenAPI failures; the subsequent baseline correction restored
both workflows, and all six service jobs in each passed on its final head.
The npm/E2E failures are not represented as passing checks or hidden by an
audit exemption.

PR #123 and the five action updates were merged on 2026-10-06 after the owner
explicitly accepted these documented limits. The
[integration review](../../docs/audits/dependabot-2026-10-06.md) records the
commits and workflow evidence. Passing unit tests and build checks do not
substitute for the blocked Docker-backed E2E flows or establish that every
GitHub check is green.

## Follow-up verification — 2026-10-08

After the integration and scoped application fixes, the production frontend build, ESLint and TypeScript passed. The complete suite passed 1,502 tests in 117 files; statements/branches/functions/lines were 95.36% / 87.94% / 95.72% / 97.14%, above the four 85% gates. Docker-backed API/browser flows can now run; the earlier missing realtime database is historical evidence, not the current blocker.

Fresh registry scans still report zero affected production dependencies and ten affected full-graph entries (seven high, three moderate), all in development dependencies. The high findings still include unpatched braces through the retained Tailwind/Next.js tooling. The existing full-graph npm high-severity CI gate is unchanged and remains failing; no override claims a patched version.
