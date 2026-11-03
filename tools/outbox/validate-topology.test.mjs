import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { validateTopology } from './validate-topology.mjs';

const now = Date.parse('2026-11-02T09:00:00.000Z');
const cliPath = fileURLToPath(new URL('./validate-topology.mjs', import.meta.url));
const owners = ['auth', 'todo', 'category', 'messaging', 'collaboration'];

function inventory(observedAt = new Date(now).toISOString()) {
  return {
    schemaVersion: 1,
    observedAt,
    source: 'docker-inspect',
    scopeId: 'disposable-test-stack',
    inventoryComplete: true,
    services: owners.map(name => ({
      name,
      databaseId: `${name}-database`,
      instances: [{ runtimeId: `${name}-instance`, state: 'running' }],
    })),
    rollout: { strategy: 'stop-before-start', autoscaling: false, automaticStart: false },
  };
}

function rejected(change) {
  const input = inventory();
  change(input);
  const result = validateTopology(input, now);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
  assert.equal(result.runtimeExclusivityVerified, false);
  assert.equal(result.releaseGate, 'T14_PENDING');
}

test('one observed running processor for every independent outbox passes only a snapshot precondition', () => {
  const result = validateTopology(inventory(), now);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.runtimeExclusivityVerified, false);
  assert.equal(result.releaseGate, 'T14_PENDING');
});

test('Fly machine inventory uses the same strict contract', () => {
  const input = inventory();
  input.source = 'fly-machines-list';
  assert.equal(validateTopology(input, now).ok, true);
});

test('freshness includes exactly five minutes but rejects older or future observations', () => {
  assert.equal(validateTopology(inventory(new Date(now - 300_000).toISOString()), now).ok, true);
  rejected(input => { input.observedAt = new Date(now - 300_001).toISOString(); });
  rejected(input => { input.observedAt = new Date(now + 1).toISOString(); });
});

test('invalid or ambiguous dates and clocks fail closed', () => {
  for (const value of [null, '', '2026-11-02', '2026-02-30T09:00:00.000Z']) {
    rejected(input => { input.observedAt = value; });
  }
  assert.equal(validateTopology(inventory(), NaN).ok, false);
});

test('missing, duplicate and unknown service owners fail closed', () => {
  rejected(input => { input.services.pop(); });
  rejected(input => { input.services.push(structuredClone(input.services[0])); });
  rejected(input => { input.services[0].name = 'realtime'; });
});

test('every owner must have exactly one running instance', () => {
  rejected(input => { input.services[0].instances = []; });
  rejected(input => { input.services[0].instances.push({ runtimeId: 'second', state: 'running' }); });
  for (const state of ['starting', 'stopping', 'stopped', 'unknown', null]) {
    rejected(input => { input.services[0].instances[0].state = state; });
  }
});

test('runtime identity must be nonempty and globally unique', () => {
  rejected(input => { input.services[1].instances[0].runtimeId = input.services[0].instances[0].runtimeId; });
  rejected(input => { input.services[0].instances[0].runtimeId = ''; });
  rejected(input => { delete input.services[0].instances[0].runtimeId; });
});

test('grouping by database identity rejects cross-service processor overlap', () => {
  rejected(input => { input.services[1].databaseId = input.services[0].databaseId; });
  rejected(input => { input.services[0].databaseId = ''; });
});

test('scope and database identifiers accept labels rather than connection strings', () => {
  rejected(input => { input.scopeId = ''; });
  rejected(input => { input.services[0].databaseId = 'Host=server;Password=fixture'; });
  rejected(input => { input.services[0].instances[0].runtimeId = 'name with whitespace'; });
});

test('completeness must be explicit and source must identify an inventory collector', () => {
  for (const value of [false, null, 'true', 1]) {
    rejected(input => { input.inventoryComplete = value; });
  }
  rejected(input => { delete input.inventoryComplete; });
  rejected(input => { input.source = 'replica-count-hint'; });
});

test('overlapping and unspecified rollout strategies fail closed', () => {
  for (const strategy of ['bluegreen', 'rolling', '', null]) {
    rejected(input => { input.rollout.strategy = strategy; });
  }
  rejected(input => { delete input.rollout; });
});

test('automatic starts and scaling cannot be accepted as single-processor topology', () => {
  for (const key of ['autoscaling', 'automaticStart']) {
    for (const value of [true, null, 'false', 0]) {
      rejected(input => { input.rollout[key] = value; });
    }
    rejected(input => { delete input.rollout[key]; });
  }
});

test('unknown and missing schema fields cannot silently alter the contract', () => {
  rejected(input => { input.schemaVersion = 2; });
  rejected(input => { input.replicas = 1; });
  rejected(input => { input.services[0].processorEnabled = false; });
  rejected(input => { input.services[0].instances[0].enabled = false; });
  rejected(input => { input.rollout.maximumReplicas = 1; });
});

test('wrong JSON shapes fail closed without throwing', () => {
  for (const input of [null, [], 'text', 5, {}, { services: {} }]) {
    assert.equal(validateTopology(input, now).ok, false);
  }
  rejected(input => { input.services = {}; });
  rejected(input => { input.services[0] = null; });
  rejected(input => { input.services[0].instances = null; });
  rejected(input => { input.services[0].instances[0] = null; });
});

test('diagnostics never echo unknown field names or supplied values', () => {
  const input = inventory();
  input['sensitive-field-fixture'] = 'sensitive-value-fixture';
  input.services[0].databaseId = 'sensitive-value-fixture=invalid';
  const result = JSON.stringify(validateTopology(input, now));
  assert.doesNotMatch(result, /sensitive-field-fixture|sensitive-value-fixture/);
});

function runCli(body, extraArgs = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'planora-outbox-topology-'));
  const snapshotPath = path.join(directory, 'snapshot.json');
  try {
    fs.writeFileSync(snapshotPath, body);
    const result = spawnSync(process.execPath, [cliPath, snapshotPath, ...extraArgs], { encoding: 'utf8' });
    assert.equal(result.error, undefined);
    return result;
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true });
  }
}

test('CLI emits a limited successful result for a fresh sanitized snapshot', () => {
  const result = runCli(JSON.stringify(inventory(new Date().toISOString())));
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'PASS_SNAPSHOT_PRECONDITION');
  assert.equal(report.runtimeExclusivityVerified, false);
  assert.equal(report.releaseGate, 'T14_PENDING');
  assert.doesNotMatch(result.stdout, /auth-instance|auth-database/);
});

test('CLI rejects invalid topology with a nonzero exit', () => {
  const input = inventory(new Date().toISOString());
  input.rollout.strategy = 'bluegreen';
  const result = runCli(JSON.stringify(input));
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).status, 'BLOCKED');
});

test('CLI malformed JSON and excessive input never leak the source text', () => {
  for (const body of ['{"sensitive-value-fixture"', 'sensitive-value-fixture'.repeat(5000)]) {
    const result = runCli(body);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).status, 'BLOCKED');
    assert.doesNotMatch(result.stdout + result.stderr, /sensitive-value-fixture/);
  }
});

test('CLI rejects absent paths, unreadable files and extra arguments', () => {
  for (const args of [[], ['missing-fixture-file.json']]) {
    const result = spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).status, 'BLOCKED');
  }
  const extra = runCli(JSON.stringify(inventory(new Date().toISOString())), ['--ignore-freshness']);
  assert.equal(extra.status, 1);
});
