#!/usr/bin/env node
//
// version-set — put every workspace package on ONE version.
//
// WHY THIS EXISTS, and why it is not changesets.
//
// This repo has NO internal dependency edges. All nine packages depend on
// @noy-db/hub (six of them) and on nothing of each other's. Changesets earns
// its keep by computing a dependency closure over a lockstep line — that is
// core's 57-package problem, not ours — and it imports pre mode, pre.json
// tracking and a normalization story along with it.
//
// ⚠️ And porting release machinery means porting its FAILURE SEMANTICS.
// noy-db's version-advanced.mjs compared versions wrongly wherever one ran out
// of segments: it REFUSED 0.7.0-pre.18 -> 0.7.0 (a real advance) and ACCEPTED
// 0.7.0 -> 0.7.0-pre.18 (a real regression). Unreachable inside a pre line,
// because there both versions have equal segment counts — so 18 green releases
// could not have caught it. This script does not order versions at all. It
// sets them. Ordering is npm's job, and check-not-already-published asks npm.
//
//   node scripts/version-set.mjs 0.7.1
//   node scripts/version-set.mjs 0.7.1 --dry-run
//
// Exit 1 on a malformed version or an unwritable manifest.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Deliberately strict. A version this script cannot parse is one the guards
// downstream cannot reason about either, and a typo here rewrites nine files.
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const target = args.find((a) => !a.startsWith('-'))

if (!target) {
  console.error('usage: node scripts/version-set.mjs <version> [--dry-run]')
  process.exit(1)
}
if (!SEMVER.test(target)) {
  console.error(`✗ not a version this script will write: ${target}`)
  console.error('  expected MAJOR.MINOR.PATCH with an optional -prerelease suffix')
  process.exit(1)
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const pkgDirs = readdirSync(ROOT)
  .filter((d) => !d.startsWith('.') && d !== 'node_modules' && d !== 'scripts')
  .filter((d) => existsSync(join(ROOT, d, 'package.json')))
  .sort()

const names = new Set(pkgDirs.map((d) => readJson(join(ROOT, d, 'package.json')).name))

// Report a COUNT, never absence-of-error. This repo currently has zero internal
// edges, so the internal-range pass is vacuous — and a vacuous pass that prints
// nothing is indistinguishable from one that did work. Print the number.
let versionsWritten = 0
let internalRangesWritten = 0

for (const dir of pkgDirs) {
  const file = join(ROOT, dir, 'package.json')
  const raw = readFileSync(file, 'utf8')
  const pkg = JSON.parse(raw)
  const before = JSON.stringify(pkg)

  pkg.version = target

  for (const field of ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies']) {
    const deps = pkg[field]
    if (!deps) continue
    for (const name of Object.keys(deps)) {
      if (!names.has(name)) continue // external — hub included; never touched here
      const caret = deps[name].startsWith('^')
      deps[name] = caret ? `^${target}` : target
      internalRangesWritten++
    }
  }

  if (JSON.stringify(pkg) === before) continue
  versionsWritten++
  if (!dryRun) writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
  console.log(`  ${dryRun ? 'would set' : 'set'} ${pkg.name.padEnd(24)} ${target}`)
}

console.log(
  `\n${dryRun ? 'DRY RUN — ' : ''}${versionsWritten} package version(s), ` +
    `${internalRangesWritten} internal range(s) updated ` +
    `(this repo has no internal edges; a non-zero count here means one was added)`,
)
console.log('\nNext: node scripts/check-versions-uniform.mjs && node scripts/check-not-already-published.mjs')
