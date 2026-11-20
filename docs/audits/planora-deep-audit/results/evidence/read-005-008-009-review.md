# READ-005, READ-008 and READ-009

Source review on 2026-11-20. Baseline file hashes matched the audit index.

| Batch | Range | Findings |
| --- | --- | --- |
| READ-005 | `.githooks/pre-commit` 1–72 | The opt-in hook reads staged paths. It runs ESLint for supported frontend paths and checks the whole solution with `dotnet format` when backend paths qualify. Tool absence skips the corresponding check. These limits are documented in `CONTRIBUTING.md`. The local Git Bash process could not start under session restrictions, so hook execution remains unverified. |
| READ-008 | `.spectral.yaml` 1–36 | The OpenAPI job lints six generated service contracts, and `--fail-severity=error` makes warnings and hints advisory. A ruleset-only change was missing from the workflow's PR paths. The path is now included, and the configuration comment matches the matrix and failure threshold. Spectral CLI pinning remains tracked under OPS-005. |
| READ-009 | `ARCHITECTURE.md` 1–92 | Checked the six service boundaries, Ocelot ingress, shared tools, Realtime persistence qualification and links against the maintained architecture and deployment guides. Added the Cloud.ru runbook and updated the migrator summary to reflect guarded schema upgrades. |

The OpenAPI workflow and Spectral ruleset parsed with PyYAML. A direct assertion
for the ruleset-only PR path failed before the change and passed after it.
GitHub execution of the full workflow remains unverified in this session.
