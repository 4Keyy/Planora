# T12 independent scoped review

Reviewed on 2026-11-03 against HEAD `db0d82acd35a705d903a2e121893034c2097ebe2`
and the working-tree scanner change. No source files were modified by this reviewer.

Verdict: **no actionable findings in the reviewed policy/test diff**. This accepts
the local OPS-010 detection change only. It does not close the full-history findings,
dependency advisory, credential provenance, CI integration or whole T12 package.

## Scope and identity

- `.gitleaks.toml` SHA256: `bbd66131b47c24940bce9e92b20695dc2f6bd9d4fa9ac480372c7603ccc6fde0`.
- `tools/security/gitleaks-policy.test.mjs` SHA256: `0371c689b8ef8baa111e0ff66a617142876e695bc21d53066ee93c59b4d761b4`.
- Gitleaks binary: `F:\Planora-Maintenance\2026-11-02-repository-review\tools\gitleaks\gitleaks.exe`.
- The reviewer used the root-verified binary; its supply-chain verification is owned
  by the root T12 evidence. The reviewer did not access credentials or working services.

## Executed checks

Working directory: `F:\Projects\Planora`.

```powershell
$env:PLANORA_GITLEAKS_BIN='F:\Planora-Maintenance\2026-11-02-repository-review\tools\gitleaks\gitleaks.exe'
node --test tools/security/gitleaks-policy.test.mjs
```

Exit **0**; **1 test passed, 0 failed, 0 skipped**, covering the existing 20 cases.
Node reported total duration 1283.1802 ms.

An additional inline Python probe was executed using `@' ... '@ | python -X utf8 -`.
It generated a new temporary `planora-t12-independent-*` directory, copied the exact
policy, generated a random 64-character hexadecimal value that was never a service
credential, and invoked the same binary with:

```text
gitleaks.exe dir <owned-temporary-directory> --config <copied-policy> --redact=100 --no-banner --no-color --report-format=json --report-path=- --log-level=error
```

The wrapper captured scanner output in memory and printed only case names,
expected/detected booleans and scanner exit code. All **12 additional cases matched
expectations**. Scanner exit **1** was expected because positive fixtures were present;
the Python wrapper exited **0**. The temporary directory was removed after checking
its resolved parent and owned prefix.

| Synthetic case | Expected and observed |
| --- | --- |
| Quoted Rabbit literal | Detected |
| Quoted required-variable reference with spaces | Not detected |
| `${VAR?message}` required-variable reference | Not detected |
| Literal default using `${VAR-value}` | Detected |
| Literal suffix after required-variable reference | Detected |
| Literal suffix after ordinary variable reference | Detected |
| Literal prefix before ordinary variable reference | Detected |
| Literal suffix after `%VAR%` | Detected |
| Literal prefix before `%VAR%` | Detected |
| Escaped `$${VAR:?message}` containing a synthetic value | Detected |
| Rabbit password in a Compose environment list | Detected |
| Rabbit password as a JSON property | Detected |

## Review limits

The removed blanket paths and substring allowlist were checked against the actual
positive/negative behavior above. The current checks retain complete-reference
exceptions and surface literal defaults and interpolated literal suffixes. This is
bounded regression evidence rather than proof that every possible credential format
is detected. Full Git-history classification, real credential usage and remote CI
state were not independently rechecked in this review.
