import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const owners = ['auth', 'todo', 'category', 'messaging', 'collaboration'];
const identifier = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const maxAgeMs = 5 * 60 * 1000;
const maxInputBytes = 64 * 1024;

function exactObject(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function result(errors) {
  return {
    ok: errors.length === 0,
    status: errors.length === 0 ? 'PASS_SNAPSHOT_PRECONDITION' : 'BLOCKED',
    runtimeExclusivityVerified: false,
    releaseGate: 'T14_PENDING',
    errors,
  };
}

// This validates collector evidence and a proposed rollout, never runtime ownership.
export function validateTopology(input, now = Date.now()) {
  const errors = [];
  if (!exactObject(input, ['schemaVersion', 'observedAt', 'source', 'scopeId', 'inventoryComplete', 'services', 'rollout'])) {
    return result(['Inventory must contain exactly the documented schema fields.']);
  }
  if (input.schemaVersion !== 1) errors.push('Unsupported inventory schema version.');
  if (typeof input.scopeId !== 'string' || !identifier.test(input.scopeId)) {
    errors.push('scopeId must be a sanitized canonical identifier.');
  }
  if (!['docker-inspect', 'fly-machines-list'].includes(input.source)) {
    errors.push('source must identify a supported observed-inventory collector.');
  }
  if (input.inventoryComplete !== true) errors.push('Inventory completeness must be explicitly attested.');

  const observed = typeof input.observedAt === 'string' ? Date.parse(input.observedAt) : NaN;
  if (!Number.isFinite(observed) || !Number.isFinite(now)
      || new Date(observed).toISOString() !== input.observedAt
      || observed > now || now - observed > maxAgeMs) {
    errors.push('Observation must be a canonical UTC timestamp no older than five minutes and not in the future.');
  }

  if (!exactObject(input.rollout, ['strategy', 'autoscaling', 'automaticStart'])
      || input.rollout.strategy !== 'stop-before-start'
      || input.rollout.autoscaling !== false || input.rollout.automaticStart !== false) {
    errors.push('Rollout must stop the previous processor before starting its replacement, without autoscaling or automatic starts.');
  }

  if (!Array.isArray(input.services)) return result([...errors, 'services must be a complete observed service inventory.']);
  if (input.services.length !== owners.length) errors.push('Inventory must contain exactly the five outbox service owners.');
  const seenOwners = new Set();
  const runtimeIds = new Set();
  const databaseCounts = new Map();
  for (const service of input.services) {
    if (!exactObject(service, ['name', 'databaseId', 'instances'])) {
      errors.push('Each service must contain exactly name, databaseId and instances.');
      continue;
    }
    if (!owners.includes(service.name) || seenOwners.has(service.name)) {
      errors.push('Service owner is unknown or repeated.');
    }
    seenOwners.add(service.name);
    const validDatabaseId = typeof service.databaseId === 'string' && identifier.test(service.databaseId);
    if (!validDatabaseId) errors.push('databaseId must be a sanitized canonical outbox database identity.');
    if (!Array.isArray(service.instances) || service.instances.length !== 1) {
      errors.push('Every owner must have exactly one observed instance; empty, ambiguous and multiple-instance inventories are blocked.');
    }
    if (!Array.isArray(service.instances)) continue;
    for (const instance of service.instances) {
      if (!exactObject(instance, ['runtimeId', 'state'])) {
        errors.push('Each instance must contain exactly runtimeId and state.');
        continue;
      }
      if (typeof instance.runtimeId !== 'string' || !identifier.test(instance.runtimeId)
          || runtimeIds.has(instance.runtimeId)) {
        errors.push('Runtime identities must be sanitized, nonempty and globally unique.');
      }
      runtimeIds.add(instance.runtimeId);
      if (instance.state !== 'running') errors.push('Every instance must be observed running; transitional, stopped and unknown states are blocked.');
      if (validDatabaseId) databaseCounts.set(service.databaseId, (databaseCounts.get(service.databaseId) ?? 0) + 1);
    }
  }
  if (owners.some(owner => !seenOwners.has(owner))) errors.push('At least one required service owner is missing.');
  if ([...databaseCounts.values()].some(count => count !== 1)) {
    errors.push('More than one processor refers to the same outbox database identity.');
  }
  return result([...new Set(errors)]);
}

function run(args) {
  if (args.length !== 1) return result(['Usage: node tools/outbox/validate-topology.mjs <sanitized-inventory.json>']);
  try {
    const stat = fs.statSync(args[0]);
    if (!stat.isFile() || stat.size > maxInputBytes) {
      return result(['Inventory must be a regular JSON file no larger than 64 KiB.']);
    }
    const bytes = fs.readFileSync(args[0]);
    if (bytes.length > maxInputBytes) return result(['Inventory exceeds the 64 KiB size limit.']);
    return validateTopology(JSON.parse(bytes.toString('utf8')));
  } catch {
    // Do not print parser/IO exceptions: they may include input values or private paths.
    return result(['Inventory could not be read or parsed as JSON.']);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = run(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}
