# T12 final scanner reconciliation

Source snapshot: `db0d82acd35a705d903a2e121893034c2097ebe2`. Final policy SHA256: `bbd66131b47c24940bce9e92b20695dc2f6bd9d4fa9ac480372c7603ccc6fde0`.

Status: **source-provenance triage complete for the current 88 unique records; scanner gate FAIL (exit 1)**. [Current-only JSON](t12-final-triage.json) records each fingerprint, historical source range, source hash and classification basis without matched values or source lines. OPS-003 remains open.

## Reconciliation

- The original scheduled scan has 66 fingerprints; 65 appear in the current final scan. Its absent launcher fingerprint is recorded in JSON as an environment-variable-reference match, not an eliminated historical credential.
- At this HEAD the committed baseline policy reports 66 records, including T01's new synthetic topology rejection fixture. The final policy reports 88: all 66 baseline records plus 22 additional records, with no baseline records removed.
- The intermediate 90-record classification file intersects the current result at 87 fingerprints. Three intermediate records are absent from the final scan; their exact IDs remain in JSON. That historical superset must not be presented as the current count.
- The only new current record outside that intermediate analysis is `tools/outbox/validate-topology.test.mjs:94` in T01. It passes a connection-shaped `databaseId` to `rejected()` to prove validator rejection; it does not connect to a database.
- Two previously unclassified Email matches are now documented placeholders by source context: a commented example-template instruction and a fenced Email Delivery documentation example. No exception was added.

## Source classifications

| Classification | Current records |
| --- | ---: |
| `ci_design_time_placeholder` | 11 |
| `ci_disposable_service_default` | 3 |
| `disposable_database_documentation` | 1 |
| `documentation_placeholder` | 21 |
| `historical_development_default_usage_unverified` | 28 |
| `marked_nonproduction_literal_usage_unverified` | 1 |
| `synthetic_test_fixture` | 22 |
| `variable_reference_not_a_literal` | 1 |

All **28 historical development defaults remain usage-unverified**. The marked nonproduction literal also remains unresolved. Workflow records were refined to distinguish EF/OpenAPI design-time inputs from job-local disposable services. Test and documentation classifications describe inspected provenance; a path or fixture keyword alone does not authorize an allowlist entry.

## Limits and next action

No automatic exceptions, credential rotation, Git-history edits or external service operations were performed. Runtime/deployed use was not checked for any record. The scanner still exits 1. Any later fingerprint exception needs its own explicit source review; values whose actual use is unknown need owner provenance/remediation before OPS-003 can close. The package report remains [T12](../T12.md); this reconciliation is not package acceptance.
