
const { spawnSync } = require('node:child_process');
const { rmSync } = require('node:fs');
const { redact } = require('./_report-redaction.cjs');
const { reportFile } = require('./_report-summary.cjs');

// JSON includes action parameters and stays outside published artifacts. Discard a stale run.
const jsonReport = reportFile();
rmSync(jsonReport, { force: true });

// Capture before publishing: browser/API errors can include secret-bearing URLs.
for (const args of [
  ['--test', 'e2e/report-redaction.test.cjs', 'e2e/report-summary.test.cjs'],
  ['node_modules/@playwright/test/cli.js', 'test', '--reporter=list,json'],
]) {
  const result = spawnSync(process.execPath, args, {
    env: { ...process.env, CI: 'true', PLAYWRIGHT_JSON_OUTPUT_FILE: jsonReport }, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  process.stdout.write(redact(result.stdout ?? ''));
  process.stderr.write(redact(result.stderr ?? ''));
  if (result.error) { process.stderr.write(redact(result.error.message) + '\n'); process.exit(1); }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
