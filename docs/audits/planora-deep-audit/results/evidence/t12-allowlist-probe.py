"""Measure scanner false negatives with generated, never-used credentials."""
import json
import pathlib
import secrets
import subprocess
import time

ROOT = pathlib.Path(__file__).resolve().parents[5]
OUTPUT = pathlib.Path(__file__).parent
TOOL = pathlib.Path(r"F:\Planora-Maintenance\2026-11-02-repository-review\tools\gitleaks\gitleaks.exe")
directory = OUTPUT / "t12-fixtures"
directory.mkdir()
generated = secrets.token_hex(32)
fixtures = {
    "control.txt": f"JWT_SECRET={generated}\n",
    "docker-compose.yml": f"JWT_SECRET={generated}\n",
    "substring.txt": f"JWT_SECRET={generated[:16]}test{generated[16:]}\n",
    "placeholder.txt": "JWT_SECRET=${JWT_SECRET:?required}\n",
}
created = []
try:
    for name, content in fixtures.items():
        path = directory / name
        path.write_text(content, encoding="utf-8")
        created.append(path)
    command = [str(TOOL), "dir", str(directory), "--config", str(ROOT / ".gitleaks.toml"),
               "--redact=100", "--no-banner", "--no-color", "--report-format=json", "--report-path=-", "--log-level=error"]
    started = time.monotonic()
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=30)
    records = json.loads(result.stdout)
    detected = {pathlib.Path(item["File"]).name for item in records}
    expected = {"control.txt": True, "docker-compose.yml": True, "substring.txt": True, "placeholder.txt": False}
    cases = [{"path": name, "expected_detection": expected[name], "observed_detection": name in detected,
              "status": "PASS" if expected[name] == (name in detected) else "FAIL"} for name in fixtures]
    report = {"command": command, "cwd": str(ROOT), "scanner_exit_code": result.returncode,
              "duration_seconds": round(time.monotonic() - started, 3), "cases": cases,
              "status": "FAIL" if any(case["status"] == "FAIL" for case in cases) else "PASS",
              "note": "Synthetic credentials were generated in memory, never used, and fixture files removed. Source scanner policy unchanged."}
    (OUTPUT / "t12-allowlist-probe.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))
finally:
    for path in created:
        if path.resolve().parent != directory.resolve() or directory.resolve().parent != OUTPUT.resolve():
            raise RuntimeError("Refusing cleanup outside owned fixture directory")
        path.unlink()
    directory.rmdir()
