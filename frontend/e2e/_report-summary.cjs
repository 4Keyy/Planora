const fs = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');

const invalidReport = () => { throw new Error('Invalid Playwright JSON report'); };
const isCount = value => Number.isSafeInteger(value) && value >= 0;

/** Only numeric aggregates may leave the private report; titles and errors can contain tokens. */
function aggregate(report) {
  if (!report?.stats || !Array.isArray(report.suites) || !Array.isArray(report.errors)) invalidReport();
  const { expected, skipped, unexpected, flaky } = report.stats;
  if (![expected, skipped, unexpected, flaky].every(isCount)) invalidReport();
  const total = expected + skipped + unexpected + flaky;
  if (!isCount(total)) invalidReport();
  let tests = 0;
  let retried = 0;
  let retryAttempts = 0;
  function visit(suites) {
    if (!Array.isArray(suites)) invalidReport();
    for (const suite of suites) {
      if (!Array.isArray(suite?.specs)) invalidReport();
      for (const spec of suite.specs) {
        if (!Array.isArray(spec?.tests)) invalidReport();
        for (const test of spec.tests) {
          if (!Array.isArray(test?.results) || !test.results.every(result => isCount(result?.retry))) invalidReport();
          tests += 1;
          const retries = test.results.filter(result => result.retry > 0).length;
          if (retries > 0) retried += 1;
          retryAttempts += retries;
        }
      }
      if (suite.suites !== undefined) visit(suite.suites);
    }
  }
  visit(report.suites);
  if (tests !== total) invalidReport();
  return { total, expected, skipped, unexpected, flaky, retried, retryAttempts, errors: report.errors.length };
}

function renderSummary(summary) {
  if (!summary) return '### Playwright E2E\n\nResults unavailable: no readable, valid JSON report was produced. Skipped and retried counts are unavailable.\n';
  return '### Playwright E2E\n\n| Result | Count |\n| --- | ---: |\n' + [
    ['Total tests', summary.total],
    ['Expected outcomes', summary.expected],
    ['Unexpected outcomes', summary.unexpected],
    ['Flaky tests', summary.flaky],
    ['Skipped tests', summary.skipped],
    ['Retried tests', summary.retried],
    ['Retry attempts', summary.retryAttempts],
    ['Global errors', summary.errors],
  ].map(([label, count]) => `| ${label} | ${count} |\n`).join('');
}

function reportFile() {
  return path.resolve(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE || path.join(tmpdir(), 'planora-playwright-results.json'));
}

module.exports = { aggregate, renderSummary, reportFile };

if (require.main === module) {
  const file = reportFile();
  let summary = null;
  try {
    summary = aggregate(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    // Do not print parse errors: they may include the report's secret-bearing contents.
  }
  const output = renderSummary(summary);
  try {
    process.stdout.write(output);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, output);
  } finally {
    fs.rmSync(file, { force: true });
  }
}
