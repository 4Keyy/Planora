import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const executable = process.env.PLANORA_GITLEAKS_BIN || "gitleaks"

test("gitleaks scans runtime paths and literal values without suppressing substrings", () => {
  const temporaryRoot = resolve(tmpdir())
  const directory = mkdtempSync(join(temporaryRoot, "planora-gitleaks-policy-"))
  // These random values have never been credentials for a service.
  const value = randomBytes(32).toString("hex")
  const cases = [
    ["control.txt", `JWT_SECRET=${value}`, true],
    ["docker-compose.yml", `JWT_SECRET=${value}`, true],
    ["docs/configuration.md", `JWT_SECRET=${value}`, true],
    [".env.example", `JWT_SECRET=${value}`, true],
    ["service.template", `JWT_SECRET=${value}`, true],
    ["CHANGELOG.md", `JWT_SECRET=${value}`, true],
    ["graphify-out/runtime.json", `JWT_SECRET=${value}`, true],
    ["substring-test.txt", `JWT_SECRET=${value.slice(0, 16)}test${value.slice(16)}`, true],
    ["substring-dummy.txt", `JWT_SECRET=${value.slice(0, 16)}dummy${value.slice(16)}`, true],
    ["reference-suffix.txt", `RABBITMQ_PASSWORD=${value}\u0024{RABBITMQ_PASSWORD}`, true],
    ["reference-default.txt", `RABBITMQ_PASSWORD=\u0024{RABBITMQ_PASSWORD:-${value}}`, true],
    ["rabbit-container-password.txt", `RABBITMQ_DEFAULT_PASS=${value}`, true],
    ["required-reference-suffix.txt", `Email__Password=\u0024{EMAIL_PASSWORD:?provide a password}${value}`, true],
    ["reference.txt", "RABBITMQ_PASSWORD=${RABBITMQ_PASSWORD}", false],
    ["required-reference.txt", "Email__Password=${EMAIL_PASSWORD:?provide a password}", false],
    ["rabbit-required-reference.txt", "RABBITMQ_PASSWORD=${RABBITMQ_PASSWORD:?provide a password}", false],
    ["rabbit-container-reference.txt", "RABBITMQ_DEFAULT_PASS=${RABBITMQ_PASSWORD:?provide a password}", false],
    ["empty-default-reference.txt", "Email__Password=${EMAIL_PASSWORD:-}", false],
    ["empty-email-setting.txt", "Email__Password=\nNONSECRET_SETTING=not-a-credential", false],
    ["configuration-reference.txt", "Email__Password=%EMAIL_PASSWORD%", false],
  ]

  try {
    const configPath = join(directory, "scanner-config.toml")
    writeFileSync(configPath, readFileSync(join(repository, ".gitleaks.toml")))
    for (const [path, line] of cases) {
      const target = join(directory, path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, `${line}\n`)
    }

    const result = spawnSync(executable, [
      "dir", directory, "--config", configPath, "--redact=100", "--no-banner", "--no-color",
      "--report-format=json", "--report-path=-", "--log-level=error", "--timeout=30",
    ], { encoding: "utf8", timeout: 40_000, windowsHide: true })
    assert.equal(result.error, undefined, "Gitleaks must be installed or configured through PLANORA_GITLEAKS_BIN")
    assert.ok(result.status === 0 || result.status === 1, `Gitleaks failed with status ${result.status}; diagnostics suppressed`)
    let report
    try {
      report = JSON.parse(result.stdout)
    } catch {
      assert.fail("Gitleaks did not return JSON; diagnostics suppressed")
    }
    const paths = report.map((entry) => entry.File.replaceAll("\\", "/"))
    const outcomes = cases.map(([path, , expected]) => ({
      path,
      expected,
      detected: paths.some((detected) => detected === path || detected.endsWith(`/${path}`)),
    }))
    assert.deepEqual(outcomes.filter(({ expected, detected }) => expected !== detected), [])
  } finally {
    const resolved = resolve(directory)
    assert.equal(dirname(resolved), temporaryRoot, "Refusing cleanup outside the owned temporary directory")
    assert.ok(resolved.startsWith(join(temporaryRoot, "planora-gitleaks-policy-")))
    rmSync(resolved, { recursive: true, force: true })
  }
})
