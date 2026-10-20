const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { aggregate, renderSummary } = require('./_report-summary.cjs');

function fixture() {
  return {
    stats: { expected: 1, skipped: 1, unexpected: 1, flaky: 1 },
    errors: [{ message: 'opaque-secret-from-global-error' }],
    suites: [{
      title: 'opaque-secret-suite',
      specs: [{ tests: [{ results: [{ retry: 0 }], status: 'expected' }] }],
      suites: [{
        title: 'nested project variants',
        specs: [{ tests: [
          { results: [], status: 'skipped' },
          { results: [{ retry: 0 }, { retry: 1 }, { retry: 2 }], status: 'flaky' },
          { results: [{ retry: 0 }, { retry: 1 }], status: 'unexpected' },
        ] }],
      }],
    }],
  };
}

test('counts skipped tests and distinct retried tests across nested suites and projects', () => {
  assert.deepEqual(aggregate(fixture()), {
    total: 4, expected: 1, skipped: 1, unexpected: 1, flaky: 1,
    retried: 2, retryAttempts: 3, errors: 1,
  });
});

test('accepts a produced zero-test report with a global failure', () => {
  assert.deepEqual(aggregate({
    stats: { expected: 0, skipped: 0, unexpected: 0, flaky: 0 },
    suites: [], errors: [{ message: 'setup failed' }],
  }), {
    total: 0, expected: 0, skipped: 0, unexpected: 0, flaky: 0,
    retried: 0, retryAttempts: 0, errors: 1,
  });
});

test('rejects missing, malformed or inconsistent counters rather than inventing zeroes', () => {
  for (const report of [null, {}, { stats: {}, suites: [], errors: [] }]) {
    assert.throws(() => aggregate(report), /Invalid Playwright JSON report/);
  }
  for (const value of [-1, 1.5, 'opaque-secret', null]) {
    const report = fixture();
    report.stats.skipped = value;
    assert.throws(() => aggregate(report), /Invalid Playwright JSON report/);
  }
  const inconsistent = fixture();
  inconsistent.stats.expected = 2;
  assert.throws(() => aggregate(inconsistent), /Invalid Playwright JSON report/);
  for (const results of [null, [null], [{ retry: 'opaque-secret' }], [{ retry: -1 }]]) {
    const report = fixture();
    report.suites[0].specs[0].tests[0].results = results;
    assert.throws(() => aggregate(report), /Invalid Playwright JSON report/);
  }
});

test('does not publish titles, errors, URLs, attachments or other report text', () => {
  const report = fixture();
  report.suites[0].specs[0].tests[0].results[0].error = { message: 'opaque-secret-result' };
  report.config = { metadata: { password: 'opaque-secret-password' } };
  const output = renderSummary(aggregate(report));
  assert(output.includes('| Skipped tests | 1 |'));
  assert(output.includes('| Retried tests | 2 |'));
  assert(output.includes('| Retry attempts | 3 |'));
  assert(!output.includes('opaque-secret'));
});

function runSummary(reportText) {
  const directory = mkdtempSync(path.join(tmpdir(), 'planora-e2e-summary-test-'));
  const reportFile = path.join(directory, 'private-report.json');
  const summaryFile = path.join(directory, 'summary.md');
  try {
    if (reportText !== undefined) writeFileSync(reportFile, reportText);
    const result = spawnSync(process.execPath, [path.join(__dirname, '_report-summary.cjs')], {
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile, GITHUB_STEP_SUMMARY: summaryFile },
      encoding: 'utf8',
    });
    return { ...result, summary: readFileSync(summaryFile, 'utf8'), reportExists: existsSync(reportFile) };
  } finally {
    assert.equal(path.dirname(directory), tmpdir());
    assert(path.basename(directory).startsWith('planora-e2e-summary-test-'));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('writes only aggregate job-summary data and removes the private JSON', () => {
  const result = runSummary(JSON.stringify(fixture()));
  assert.equal(result.status, 0);
  assert.equal(result.reportExists, false);
  assert.equal(result.stdout, result.summary);
  assert(result.summary.includes('| Total tests | 4 |'));
  assert(!result.summary.includes('opaque-secret'));
  assert.equal(result.stderr, '');
});

test('marks counts unavailable when no report was produced', () => {
  const result = runSummary();
  assert.equal(result.status, 0);
  assert(result.summary.includes('unavailable'));
  assert(!result.summary.includes('| Skipped tests | 0 |'));
  assert(!result.summary.includes('| Retried tests | 0 |'));
});

test('invalid JSON remains private and reports unavailable without echoing parse errors', () => {
  const result = runSummary('opaque-secret-invalid-json');
  assert.equal(result.status, 0);
  assert.equal(result.reportExists, false);
  assert(result.summary.includes('unavailable'));
  assert(!result.stdout.includes('opaque-secret'));
  assert(!result.stderr.includes('opaque-secret'));
});
