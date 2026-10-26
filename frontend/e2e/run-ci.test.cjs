const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('./run-ci.cjs');

function sink() {
  const lines = [];
  return { lines, write: (text) => { lines.push({ text, at: Date.now() }); return true; } };
}

test('prints each redacted line while the child is still running', async () => {
  const stdout = sink();
  const stderr = sink();
  // The child prints, then keeps running; the line must arrive before it exits.
  const script = "console.log('Authorization: Bearer opaque-auth-value'); console.error('GET /reset?token=opaque-token&page=1'); setTimeout(() => {}, 600)";

  const status = await run(['-e', script], { stdout, stderr });
  const exitedAt = Date.now();

  assert.equal(status, 0);
  assert.deepEqual(stdout.lines.map((line) => line.text), ['Authorization: Bearer [REDACTED]\n']);
  assert.deepEqual(stderr.lines.map((line) => line.text), ['GET /reset?token=[REDACTED]&page=1\n']);
  assert(exitedAt - stdout.lines[0].at >= 300, 'the line was printed before the child exited');
});

test('keeps the last line without a newline and passes the exit status on', async () => {
  const stdout = sink();
  const status = await run(['-e', "process.stdout.write('3 failed'); process.exitCode = 3"], { stdout, stderr: sink() });

  assert.equal(status, 3);
  assert.deepEqual(stdout.lines.map((line) => line.text), ['3 failed\n']);
});

test('reports a child killed by a signal as a failure', async () => {
  const status = await run(['-e', "process.kill(process.pid, 'SIGTERM'); setTimeout(() => {}, 1000)"], { stdout: sink(), stderr: sink() });

  assert.notEqual(status, 0);
});
