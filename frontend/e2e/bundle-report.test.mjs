import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { collectBundleReport, checkBudget } from '../scripts/bundle-report.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'planora-bundle-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const put = async (name, value) => {
    const file = path.join(root, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, value)
  }
  await put('static/chunks/shared.js', 'shared code;'.repeat(100))
  await put('static/chunks/tasks.js', 'task code;'.repeat(50))
  await put('static/css/main.css', 'body{color:black}')
  await put('static/chunks/shared.js.map', '{}')
  await put('server/app/(app)/tasks/page_client-reference-manifest.js',
    'globalThis.__RSC_MANIFEST["/(app)/tasks/page"] = ' + JSON.stringify({
      clientModules: { a: { chunks: ['/_next/static/chunks/shared.js', '/_next/static/chunks/tasks.js'] },
        b: { chunks: ['/_next/static/chunks/shared.js'] } },
    }))
  await put('server/app/page_client-reference-manifest.js',
    'globalThis.__RSC_MANIFEST["/page"] = ' + JSON.stringify({ chunks: ['/_next/static/chunks/shared.js'] }))
  return { root, put }
}

test('deduplicates each route, strips route groups, and totals JS/CSS separately from maps', async (t) => {
  const { root } = await fixture(t)
  const report = await collectBundleReport(root)
  assert.deepEqual(report.routes.map(({ route, chunks }) => [route, chunks]), [['/', 1], ['/tasks', 2]])
  assert.equal(report.routes[1].rawBytes, Buffer.byteLength('shared code;'.repeat(100) + 'task code;'.repeat(50)))
  assert.equal(report.routes[1].gzipBytes,
    gzipSync('shared code;'.repeat(100), { level: 9 }).length + gzipSync('task code;'.repeat(50), { level: 9 }).length)
  assert.equal(report.static.jsFiles, 2)
  assert.equal(report.static.cssFiles, 1)
  assert.equal(report.static.sourceMaps, 1)
  assert.equal(report.static.rawBytes, report.routes[1].rawBytes + Buffer.byteLength('body{color:black}'))
})

test('merges multiple manifests for the same public route without counting shared chunks twice', async (t) => {
  const { root, put } = await fixture(t)
  await put('server/app/(other)/tasks/page_client-reference-manifest.js',
    'globalThis.__RSC_MANIFEST["/(other)/tasks/page"] = {"chunks":["/_next/static/chunks/shared.js"]}')
  const report = await collectBundleReport(root)
  assert.equal(report.routes.length, 2)
  assert.equal(report.routes[1].chunks, 2)
})

test('fails on absent manifests, missing chunks and path traversal', async (t) => {
  const { root, put } = await fixture(t)
  await assert.rejects(collectBundleReport(path.join(root, 'missing')), /manifest|ENOENT/)
  const manifest = 'server/app/page_client-reference-manifest.js'
  await put(manifest, 'globalThis.__RSC_MANIFEST["/page"]={"chunks":["static/chunks/missing.js"]}')
  await assert.rejects(collectBundleReport(root), /missing\.js/)
  await put(manifest, 'globalThis.__RSC_MANIFEST["/page"]={"chunks":["static/chunks/../../outside.js"]}')
  await assert.rejects(collectBundleReport(root), /Unsafe chunk/)
})

test('budgets check exact gzip bytes, every route, and the unique static total', async (t) => {
  const { root } = await fixture(t)
  const report = await collectBundleReport(root)
  const budget = { version: 1, totalGzipKB: report.static.gzipBytes / 1024,
    routes: Object.fromEntries(report.routes.map((route) => [route.route, route.gzipBytes / 1024])) }
  assert.deepEqual(checkBudget(report, budget), [])
  assert.equal(checkBudget(report, { ...budget, totalGzipKB: 0 }).length, 1)
  assert.equal(checkBudget(report, { ...budget, routes: { '/': 0 } }).length, 2)
  assert.throws(() => checkBudget(report, { ...budget, totalGzipKB: -1 }), /budget/i)
  assert.throws(() => checkBudget(report, { ...budget, routes: { '/': '100' } }), /budget/i)
})

test('CLI uses NEXT_DIST_DIR, emits parseable JSON, and fails an exceeded budget', async (t) => {
  const { root, put } = await fixture(t)
  const script = path.resolve('scripts/bundle-report.mjs')
  const options = { cwd: root, env: { ...process.env, NEXT_DIST_DIR: root }, encoding: 'utf8' }
  const good = spawnSync(process.execPath, [script, '--json'], options)
  assert.equal(good.status, 0, good.stderr)
  assert.equal(JSON.parse(good.stdout).routes.length, 2)
  await put('budget.json', JSON.stringify({ version: 1, totalGzipKB: 0, routes: { '/': 0, '/tasks': 0 } }))
  const bad = spawnSync(process.execPath, [script, '--json', '--budget', 'budget.json'], options)
  assert.equal(bad.status, 1)
  assert.equal(JSON.parse(bad.stdout).budgetFailures.length, 3)
})
