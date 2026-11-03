"""Keep secret values and scanner diagnostics in memory; persist metadata only."""
import collections
import argparse
import hashlib
import json
import pathlib
import subprocess
import time

ROOT = pathlib.Path(__file__).resolve().parents[5]
OUTPUT = pathlib.Path(__file__).parent
TOOL = pathlib.Path(r"F:\Planora-Maintenance\2026-11-02-repository-review\tools\gitleaks\gitleaks.exe")
parser = argparse.ArgumentParser()
parser.add_argument("--baseline", action="store_true", help="Use the committed policy, preserving the working tree")
arguments = parser.parse_args()
label = "before" if arguments.baseline else "after"
config_path = ROOT / ".gitleaks.toml"
head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
if arguments.baseline:
    config_path = OUTPUT / "t12-baseline-config.toml"
    policy = subprocess.run(["git", "show", f"{head}:.gitleaks.toml"], cwd=ROOT, capture_output=True, check=True).stdout
    config_path.write_bytes(policy)
command = [str(TOOL), "git", str(ROOT), "--config", str(config_path),
           "--log-opts=--all", "--redact=100", "--no-banner", "--no-color",
           "--report-format=json", "--report-path=-", "--log-level=error", "--timeout=180"]
started = time.monotonic()
try:
    result = subprocess.run(command, cwd=ROOT, text=True, encoding="utf-8", errors="replace", capture_output=True, timeout=200)
    policy_hash = hashlib.sha256(config_path.read_bytes()).hexdigest()
finally:
    if arguments.baseline:
        config_path.unlink()
elapsed = round(time.monotonic() - started, 3)
try:
    raw_records = json.loads(result.stdout)
except json.JSONDecodeError:
    raise SystemExit(f"Scanner report unavailable; exit={result.returncode}; diagnostics suppressed")
metadata = [{key: item.get(key) for key in
             ("RuleID", "File", "Commit", "StartLine", "EndLine", "Fingerprint")}
            for item in raw_records]
report = {"command": command, "cwd": str(ROOT), "exit_code": result.returncode,
          "label": label, "head": head, "policy_sha256": policy_hash,
          "duration_seconds": elapsed, "count": len(metadata),
          "diagnostic_lines_suppressed": len(result.stderr.splitlines()), "findings": metadata}
(OUTPUT / f"t12-gitleaks-history-{label}.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"exit_code": result.returncode, "duration_seconds": elapsed, "count": len(metadata),
                  "rules": dict(collections.Counter(x["RuleID"] for x in metadata))}))
