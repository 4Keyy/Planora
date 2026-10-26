
const { spawn } = require('node:child_process');
const { rmSync } = require('node:fs');
const { createInterface } = require('node:readline');
const { redact } = require('./_report-redaction.cjs');
const { reportFile } = require('./_report-summary.cjs');

/**
 * Run `node <args>` and print its output while it runs, one redacted line at a time: browser/API
 * errors can include secret-bearing URLs, and every redaction pattern lies within one line. The
 * output used to be printed only when the child exited, so a job cut off by its timeout showed
 * nothing about which test was running or why the earlier ones failed.
 */
function run(args, { env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const printed = [[child.stdout, stdout], [child.stderr, stderr]].map(([from, to]) => new Promise((done) => {
      createInterface({ input: from, crlfDelay: Infinity })
        .on('line', (line) => to.write(redact(line) + '\n'))
        .on('close', done);
    }));
    child.on('error', (error) => { stderr.write(redact(error.message) + '\n'); resolve(1); });
    child.on('close', (status) => { Promise.all(printed).then(() => resolve(status ?? 1)); });
  });
}

async function main() {
  // JSON includes action parameters and stays outside published artifacts. Discard a stale run.
  const jsonReport = reportFile();
  rmSync(jsonReport, { force: true });
  const env = { ...process.env, CI: 'true', PLAYWRIGHT_JSON_OUTPUT_FILE: jsonReport };

  // Further arguments go to Playwright: CI passes its shard, `--shard=2/3`.
  for (const args of [
    ['--test', 'e2e/report-redaction.test.cjs', 'e2e/report-summary.test.cjs', 'e2e/run-ci.test.cjs'],
    ['node_modules/@playwright/test/cli.js', 'test', '--reporter=list,json', ...process.argv.slice(2)],
  ]) {
    const status = await run(args, { env });
    if (status !== 0) process.exit(status);
  }
}

if (require.main === module) main();

module.exports = { run };
