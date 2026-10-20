import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const KB = 1024

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : entry.isFile() ? [target] : []
  }))
  return files.flat().sort()
}

function publicRoute(manifest, appDirectory, source) {
  const assignment = source.match(/__RSC_MANIFEST\[("(?:\\.|[^"\\])*")\]\s*=/)
  const route = assignment ? JSON.parse(assignment[1])
    : path.relative(appDirectory, manifest).replaceAll(path.sep, '/').replace(/_client-reference-manifest\.js$/, '')
  return '/' + route.split('/').filter((part) => part && !/^\(.*\)$/.test(part)
    && !part.startsWith('@')).filter((part, index, parts) => !(['page', 'route'].includes(part) && index === parts.length - 1)).join('/')
}

export async function collectBundleReport(buildDirectory) {
  const root = path.resolve(buildDirectory)
  const appDirectory = path.join(root, 'server', 'app')
  const manifests = (await walk(appDirectory)).filter((file) => file.endsWith('_client-reference-manifest.js'))
  if (!manifests.length) throw new Error(`No client reference manifests in ${appDirectory}; run a production build first`)
  const byRoute = new Map()
  for (const manifest of manifests) {
    // Read manifest data without evaluating generated JavaScript.
    const source = await readFile(manifest, 'utf8')
    const route = publicRoute(manifest, appDirectory, source)
    const chunks = byRoute.get(route) ?? new Set()
    for (const match of source.matchAll(/static\/chunks\/[^"'\\\s?#]+\.js/g)) {
      const chunk = match[0]
      if (chunk.split('/').some((segment) => segment === '..' || segment === '.')) {
        throw new Error(`Unsafe chunk path in ${manifest}: ${chunk}`)
      }
      chunks.add(chunk)
    }
    byRoute.set(route, chunks)
  }
  const sizes = new Map()
  async function size(file) {
    if (!sizes.has(file)) {
      const bytes = await readFile(file)
      sizes.set(file, { rawBytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length })
    }
    return sizes.get(file)
  }
  async function sum(files) {
    const totals = { rawBytes: 0, gzipBytes: 0 }
    for (const file of files) {
      const measured = await size(file)
      totals.rawBytes += measured.rawBytes
      totals.gzipBytes += measured.gzipBytes
    }
    return totals
  }
  const routes = []
  for (const [route, chunks] of [...byRoute].sort(([a], [b]) => a.localeCompare(b))) {
    routes.push({ route, chunks: chunks.size, ...await sum([...chunks].sort().map((file) => path.join(root, file))) })
  }
  const staticFiles = await walk(path.join(root, 'static'))
  const js = staticFiles.filter((file) => file.endsWith('.js'))
  const css = staticFiles.filter((file) => file.endsWith('.css'))
  return {
    version: 1,
    distDir: path.relative(process.cwd(), root).replaceAll(path.sep, '/') || '.',
    routes,
    static: {
      jsFiles: js.length,
      cssFiles: css.length,
      sourceMaps: staticFiles.filter((file) => file.endsWith('.map')).length,
      js: await sum(js),
      css: await sum(css),
      ...await sum([...js, ...css]),
    },
  }
}

export function checkBudget(report, budget) {
  const validLimit = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0
  if (budget?.version !== 1 || !validLimit(budget.totalGzipKB) || !budget.routes
    || Array.isArray(budget.routes) || typeof budget.routes !== 'object'
    || Object.values(budget.routes).some((value) => !validLimit(value))) {
    throw new Error('Invalid bundle budget: expected version 1 and non-negative numeric gzip KB limits')
  }
  const failures = []
  function compare(label, bytes, limit) {
    if (bytes > limit * KB) failures.push(`${label}: ${(bytes / KB).toFixed(2)} KB gzip exceeds ${limit} KB`)
  }
  compare('Static JS + CSS total', report.static.gzipBytes, budget.totalGzipKB)
  for (const { route, gzipBytes } of report.routes) {
    if (!Object.hasOwn(budget.routes, route)) failures.push(`${route}: missing route budget`)
    else compare(route, gzipBytes, budget.routes[route])
  }
  for (const route of Object.keys(budget.routes)) {
    if (!report.routes.some((entry) => entry.route === route)) failures.push(`${route}: budget has no matching built route`)
  }
  return failures
}

function printTable(report) {
  const width = Math.max(5, ...report.routes.map(({ route }) => route.length))
  console.log(`${'Route'.padEnd(width)}  Chunks    Raw KB   Gzip KB`)
  for (const row of report.routes) {
    console.log(`${row.route.padEnd(width)}  ${String(row.chunks).padStart(6)}  ${(row.rawBytes / KB).toFixed(2).padStart(8)}  ${(row.gzipBytes / KB).toFixed(2).padStart(8)}`)
  }
  const total = report.static
  console.log(`\nUnique static JS + CSS: ${total.jsFiles} JS, ${total.cssFiles} CSS; ${(total.rawBytes / KB).toFixed(2)} KB raw, ${(total.gzipBytes / KB).toFixed(2)} KB gzip; ${total.sourceMaps} source maps`)
  console.log('KB = 1024 bytes. Gzip level 9; shared chunks count once per route and once in the static total.')
}

async function main(args) {
  let json = false
  let budgetFile
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--json') json = true
    else if (args[index] === '--budget' && args[index + 1] && !args[index + 1].startsWith('--')) budgetFile = args[++index]
    else throw new Error('Usage: node scripts/bundle-report.mjs [--json] [--budget <file>]')
  }
  const report = await collectBundleReport(process.env.NEXT_DIST_DIR || '.next')
  if (budgetFile) report.budgetFailures = checkBudget(report, JSON.parse(await readFile(budgetFile, 'utf8')))
  if (json) console.log(JSON.stringify(report, null, 2))
  else {
    printTable(report)
    if (budgetFile) {
      for (const failure of report.budgetFailures) console.error(failure)
      if (!report.budgetFailures.length) console.log('Bundle budget passed.')
    }
  }
  if (report.budgetFailures?.length) process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Bundle report failed: ${error.message}`)
    process.exitCode = 1
  })
}
