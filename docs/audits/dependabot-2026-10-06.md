# Dependabot Integration Review — 2026-10-06

All six open Dependabot pull requests were reviewed and integrated into `main`.
The owner explicitly accepted the documented development-dependency audit and
existing E2E limitations. Audit gates remain enabled. Successful unit tests and
builds do not establish that all security checks or database-backed flows pass.

The pre-integration baseline was
`7a11a875cbddedb19a72072a143b6cf92c9e24e2`; the combined dependency revision is
`5dab1618d884d17a00e167ba2bd4d9ad840608fc`. The repository permits squash merges
only. Each request therefore produced a separate commit on current `main`,
with the reviewed PR head supplied to GitHub's merge API as a concurrency guard.
The local checkout was fast-forwarded after every merge.

## Integrated requests

| Request | Reviewed change | Commit on main |
|---|---|---|
| [#123](https://github.com/4Keyy/Planora/pull/123) | Frontend patch/minor group plus compatible security corrections | [5f8b485](https://github.com/4Keyy/Planora/commit/5f8b4857c55f513f1c1ea7c28497533af1b0b043) |
| [#110](https://github.com/4Keyy/Planora/pull/110) | CodeQL initialization 4.36.2 → 4.36.3 | [42ce512](https://github.com/4Keyy/Planora/commit/42ce512d03d40ceb708b4b0e8368e3568632ba4f) |
| [#109](https://github.com/4Keyy/Planora/pull/109) | CodeQL analysis 4.36.2 → 4.36.3 | [14ff91e](https://github.com/4Keyy/Planora/commit/14ff91e0da2a1ca48c8595bc928d695aedd52231) |
| [#111](https://github.com/4Keyy/Planora/pull/111) | CodeQL SARIF upload 4.36.2 → 4.36.3 | [17850db](https://github.com/4Keyy/Planora/commit/17850dbc12152a3f0304176b7b46be9e98c8ca24) |
| [#108](https://github.com/4Keyy/Planora/pull/108) | markdownlint action 23.2.0 → 24.0.0 | [bcebbfe](https://github.com/4Keyy/Planora/commit/bcebbfe87f2e43fd1b7602e73313106085ef0532) |
| [#106](https://github.com/4Keyy/Planora/pull/106) | setup-dotnet 5.3.0 → 5.4.0, seven uses in five workflows | [5dab161](https://github.com/4Keyy/Planora/commit/5dab1618d884d17a00e167ba2bd4d9ad840608fc) |

The action revisions were checked against their upstream release tags,
including dereferencing annotated tags. Workflow permissions, job commands,
environment variables and scanner thresholds were unchanged by these five PRs.

| Action release | Immutable commit used in workflows |
|---|---|
| github/codeql-action 4.36.3 | `54f647b7e1bb85c95cddabcd46b0c578ec92bc1a` |
| DavidAnson/markdownlint-cli2-action 24.0.0 | `8de2aa07cae85fd17c0b35642db70cf5495f1d25` |
| actions/setup-dotnet 5.4.0 | `26b0ec14cb23fa6904739307f278c14f94c95bf1` |

## Frontend dependency graph

The original npm PR's Next.js 16.3.5 still had a reported critical advisory.
The reviewed update uses Next.js and eslint-config-next **16.3.8**, Vitest and
its V8 coverage provider **4.1.11**, and undici **7.30.0**. Compatible transitive
refreshes include sharp **0.35.5** and source-map-js **1.2.2**. React/React DOM
**18.3.1**, Tailwind **3.4.19** and framer-motion **11.18.2** remain unchanged.
The [frontend security review](../../.github/security/frontend-dependencies-2026-10.md)
records the advisory sources and remaining findings.

The dependency-key sets and npm scripts were preserved. Linux SWC/sharp optional
packages remain in the lockfile alongside Windows packages. A resolution check
of 783 unchanged consumer requirements found no version decreases; changed
hoisting locations were assessed through the consuming package's resolved
version rather than treating relocation as a downgrade.

## Preservation and verification

The combined revision was compared with the pre-integration baseline using Git
tree diffs. Application source in `frontend/src`, `Services`, `BuildingBlocks`,
the gateway and tools, plus backend and browser test files, is identical.
The tested frontend candidate and combined revision differ only in the five
reviewed workflow files. Earlier user commits remain ancestors of `main`.

Updating #123 with the final baseline produced one conflict in `CHANGELOG.md`.
Both complete entries were retained: the dependency update and the CI artifact
correction. No application-source conflict occurred. No force push, history
reset or production database operation was used.

| Check | Observed result | Scope / evidence |
|---|---|---|
| Fresh .NET restore and Release build with `-warnaserror` | Passed | Isolated Git checkout; root service DLLs were locked by running local services, which were left running |
| Backend tests after the last source/tooling correction | 972 passed, zero failed/skipped | 882 UnitTests and 90 ErrorHandlingTests; backend source unchanged by the six merges |
| Locked frontend installation, ESLint and TypeScript | Passed | Reviewed npm candidate, same frontend tree and lockfile as combined main |
| Frontend Vitest | 100 files, 1,231 tests passed | V8 statements/branches/functions/lines: 94.48% / 86.46% / 94.20% / 96.34%; all four 85% gates passed |
| Next.js production build | Passed | 14 dynamic routes; isolated output; generated tracked configuration edits restored from pre-build copies |
| Runtime npm scan | Zero affected package entries | `npm audit --omit=dev`; registry snapshot at review time |
| Full npm scan | 7 high and 3 moderate affected entries | Development-tool graph; high-severity gate continues to fail |
| NuGet transitive scan | No vulnerable packages reported | XML cryptography corrected to 10.0.12 before PR integration; auditing stays enabled |
| SQL artifact generation | All six service jobs passed | [#106 migration workflow](https://github.com/4Keyy/Planora/actions/runs/37500263359); generation does not establish complete migration history |
| OpenAPI extraction / Spectral | All six service jobs passed | [#106 OpenAPI workflow](https://github.com/4Keyy/Planora/actions/runs/37500263579); configured warnings/hints remain nonfatal |
| Pre-merge GitHub CI | Docs, backend and frontend passed | [Final #123 head](https://github.com/4Keyy/Planora/actions/runs/37500654151) |

## Remaining CI limits

The full-graph `npm-audit` failure is expected from the recorded development
dependencies. The high findings include the unpatched published braces 3.0.3
chain; the review did not add audit exceptions or force unrelated major updates.
Runtime-only npm scanning and the NuGet scan were clean at review time. Scanner
counts do not prove application reachability or absence of other vulnerabilities.

The separate CodeQL init/analyze PRs failed with a configuration-version mismatch
because one step used 4.36.2 and the other 4.36.3. Combined main pins all three
CodeQL actions to the same 4.36.3 commit; this transient incompatibility is absent
from its workflow. One older #109 frontend run also failed in the landing-circle
test; the later #123 full suite passed without replacing application tests.

The [earlier #123 E2E run](https://github.com/4Keyy/Planora/actions/runs/37498488021)
failed while waiting for the Docker stack because `planora_realtime` was absent.
It did not execute browser flows. Four locally discovered motion/geometry tests
were skipped when the frontend server was unavailable. Neither result is a
passing E2E assertion. Fresh-database migration history and deployment blockers
remain documented in the [repository audit](2026-10-06.md) and
[deployment guide](../deployment.md#confirmed-rollout-blockers).

The first [CI on combined main](https://github.com/4Keyy/Planora/actions/runs/37501415530)
and [Security Scan on combined main](https://github.com/4Keyy/Planora/actions/runs/37501415536)
were cancelled by workflow concurrency during the closely spaced integration
pushes. Docs, backend, NuGet, gitleaks and Trivy jobs had already succeeded;
the npm job reported the expected 7 high / 3 moderate development findings.
Cancelled frontend/CodeQL jobs are not counted as successful checks. These
partial results are distinct from the complete pre-merge checks above.
The owner's acceptance of these integration limits does not certify production
readiness or close the unrelated findings in the repository audit.
