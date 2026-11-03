"""Classify source provenance without writing literals or matched source lines."""
import collections
import argparse
import json
import pathlib
import re
import subprocess
import tomllib

ROOT = pathlib.Path(__file__).resolve().parents[5]
OUTPUT = pathlib.Path(__file__).parent
rules = {item["id"]: item for item in tomllib.loads((ROOT / ".gitleaks.toml").read_text(encoding="utf-8-sig"))["rules"]}
records = json.loads((OUTPUT / "t12-scanner-fingerprints.json").read_text(encoding="utf-8-sig"))
parser = argparse.ArgumentParser()
parser.add_argument("--expanded", action="store_true")
arguments = parser.parse_args()
if arguments.expanded:
    seen = {f'{item["commit"]}:{item["path"]}:{item["rule"]}:{item["line"]}' for item in records}
    added = json.loads((OUTPUT / "t12-gitleaks-history-after.json").read_text(encoding="utf-8"))
    records.extend({"commit": item["Commit"], "path": item["File"], "rule": item["RuleID"], "line": item["StartLine"]}
                   for item in added["findings"] if item["Fingerprint"] not in seen)
current = json.loads((OUTPUT / "t12-gitleaks-history-before.json").read_text(encoding="utf-8"))
current_ids = {item["Fingerprint"] for item in current["findings"]}
cache = {}
reviewed_contexts = {
    "docs/testing.md": ("disposable_database_documentation", "The adjacent documented initdb/start/test/stop sequence creates a temporary trust-authenticated PostgreSQL fixture; no external credential source."),
    ".github/workflows/perf-smoke.yml": ("ci_disposable_service_default", "The value is emitted by the workflow into .env.perf for its disposable Compose workload."),
    ".github/workflows/e2e.yml": ("ci_disposable_service_default", "The value is emitted by the workflow into .env.e2e for its disposable Compose workload."),
    ".github/workflows/openapi.yml": ("ci_design_time_placeholder", "Development startup environment explicitly documents synthetic placeholders used for OpenAPI extraction."),
    ".github/workflows/migrations.yml": ("ci_design_time_placeholder", "Design-time EF script generation uses literal-only job inputs rather than a production secret provider."),
    "tests/Planora.UnitTests/BuildingBlocks/Grpc/ServiceKeyInterceptorTests.cs": ("synthetic_test_fixture", "A test-only constant is passed to in-memory IConfiguration for interceptor assertions."),
    "frontend/src/test/lib/jwt.test.ts": ("synthetic_test_fixture", "The split token is a test-only HS256 parser fixture with a documented synthetic payload, not a runtime token source."),
    "tests/Planora.UnitTests/Services/AuthApi/Infrastructure/Authentication/TokenServiceTests.cs": ("synthetic_test_fixture", "The private CreateSettings test helper constructs JwtSettings with a literal and test issuer/audience."),
    "tests/Planora.UnitTests/Services/Infrastructure/DependencyInjectionContractTests.cs": ("synthetic_test_fixture", "The test supplies an in-memory configuration dictionary and asserts DI descriptors/options; no credential provider is read."),
    "tests/Planora.UnitTests/Services/AuthApi/Controllers/AuthenticationControllerTests.cs": ("synthetic_test_fixture", "The literal is part of a TokenDto supplied by a mocked mediator to controller assertions."),
}

def source(commit, path):
    key = (commit, path)
    if key not in cache:
        completed = subprocess.run(["git", "show", f"{commit}:{path}"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if completed.returncode and commit != "HEAD":
            raise RuntimeError("Historical source unavailable; metadata-only failure")
        cache[key] = completed.stdout
    return cache[key]

for item in records:
    path, commit, line_number, rule_id = item["path"], item["commit"], item["line"], item["rule"]
    historic = source(commit, path)
    lines = historic.splitlines()
    line = lines[line_number - 1]
    rule = rules.get(rule_id)
    if rule:
        match = re.search(rule["regex"], line)
        literal = match.group(rule.get("secretGroup", 0)) if match else None
    else:
        match = re.search(r"(?:SECRET|TOKEN|KEY)\s*=\s*[\"']([^\"']+)", line, re.I)
        literal = match.group(1) if match else None
    is_test = path.startswith("tests/") or "/src/test/" in path
    is_workflow = path.startswith(".github/workflows/")
    has_marker = bool(literal and re.search(r"test|dummy|fake|placeholder|example|change.?me|dev.only|development", literal, re.I))
    variable_reference = bool(literal and re.search(r"\$\{|\$[A-Za-z_]|%[A-Z_]+%", literal))
    common_default = bool(literal and literal.casefold() in {"postgres", "guest", "password", "planora"})
    non_routable = bool(literal and (re.search(r"[<>]", literal) or literal.lower() in {"your_password", "your-rabbitmq-password"}))
    if variable_reference:
        classification = "variable_reference_not_a_literal"
    elif non_routable:
        classification = "documentation_placeholder"
    elif is_test and (has_marker or common_default):
        classification = "synthetic_test_fixture"
    elif is_workflow and (has_marker or common_default):
        classification = "ci_disposable_service_default"
    elif common_default:
        classification = "historical_development_default_usage_unverified"
    elif has_marker:
        classification = "marked_nonproduction_literal_usage_unverified"
    elif is_test:
        classification = "test_context_literal_needs_manual_provenance"
    elif literal is None:
        classification = "scanner_match_not_reproduced_by_current_rule"
    else:
        classification = "unclassified_literal_needs_owner_review"
    basis = "Literal shape plus source provenance; not a deployed credential check."
    if classification in {"unclassified_literal_needs_owner_review", "test_context_literal_needs_manual_provenance"} and path in reviewed_contexts:
        classification, basis = reviewed_contexts[path]
    head_source = source("HEAD", path)
    if rule:
        head_matches = [match.group(rule.get("secretGroup", 0)) for source_line in head_source.splitlines()
                        for match in re.finditer(rule["regex"], source_line)]
        equivalent_match_at_head = bool(literal and literal in head_matches)
    else:
        equivalent_match_at_head = None
    item.update({"fingerprint": f"{commit}:{path}:{rule_id}:{line_number}",
                 "classification": classification, "rule_match_at_reported_line": literal is not None,
                 "classification_basis": basis,
                 "deliberate_fixture_marker": has_marker, "common_default": common_default,
                 "variable_reference": variable_reference,
                 "same_literal_under_current_rule_in_head_file": equivalent_match_at_head,
                 "source_lines": len(lines), "current_scanner_reports": f"{commit}:{path}:{rule_id}:{line_number}" in current_ids})
output_name = "t12-scanner-triage-expanded.json" if arguments.expanded else "t12-scanner-triage.json"
(OUTPUT / output_name).write_text(json.dumps({"method": "Historical blob and current rule inspection; source values held only in memory; no deployed credential validation", "count": len(records), "classifications": records}, indent=2) + "\n", encoding="utf-8")
print(json.dumps(dict(collections.Counter(item["classification"] for item in records))))
for item in records:
    print(f'{item["classification"]}: {item["path"]}:{item["line"]} [HEAD rule matches={item["same_literal_under_current_rule_in_head_file"]}]')
