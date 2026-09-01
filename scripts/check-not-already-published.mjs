#!/usr/bin/env node
//
// check-not-already-published — git is not npm, made executable.
//
// WHY THIS EXISTS.
//
// This repo was extracted from noy-db at 0.7.0-pre.17. noy-db then cut 0.7.0
// for all 57 packages and removed the on-* family immediately afterwards. So
// npm carried 0.7.0 for all nine of these packages while every manifest here
// still said 0.7.0-pre.17, and nothing in this repo knew. It took three
// sessions measuring by hand to establish that. This script is that
// measurement, executable, in about a second.
//
// ⚠️ NEVER READ A TARGET VERSION OUT OF A package.json. The version in a
// manifest is what someone INTENDS; the registry is what EXISTS. A publish of
// a version npm already carries is EPUBLISHCONFLICT at best, and at worst it
// is the discovery that a sibling repo shipped your line while you were not
// looking.
//
// ⚠️ IT FAILS CLOSED. A network error, a registry timeout, an auth problem —
// none of these mean "the version is free". They mean the question was not
// answered, and a check that cannot distinguish `could not confirm` from
// `confirmed fine` is worse than no check, because it is reassuring. The
// family record calls this collapse the recurring bug: never render a degraded
// state identically to a healthy one. Exit 2 says "I could not tell you".
//
//   node scripts/check-not-already-published.mjs           # version from the manifests
//   node scripts/check-not-already-published.mjs 0.7.1     # a version you are considering
//
// Exit 0 free to publish · 1 already published · 2 could not determine.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

const pkgs = readdirSync(ROOT)
  .filter((d) => !d.startsWith('.') && d !== 'node_modules' && d !== 'scripts')
  .filter((d) => existsSync(join(ROOT, d, 'package.json')))
  .sort()
  .map((d) => readJson(join(ROOT, d, 'package.json')))

const argVersion = process.argv.slice(2).find((a) => !a.startsWith('-'))
const distinct = [...new Set(pkgs.map((p) => p.version))]
if (!argVersion && distinct.length !== 1) {
  console.error(`✗ manifests hold ${distinct.length} distinct versions — run check-versions-uniform.mjs first`)
  process.exit(2)
}
const target = argVersion ?? distinct[0]
console.log(`asking npm whether ${pkgs.length} package(s) already carry ${target}\n`)

const check = async (pkg) => {
  try {
    const { stdout } = await exec('npm', ['view', `${pkg.name}`, 'versions', '--json'], { timeout: 60_000 })
    const versions = JSON.parse(stdout)
    const all = Array.isArray(versions) ? versions : [versions]
    return { name: pkg.name, state: all.includes(target) ? 'published' : 'free' }
  } catch (err) {
    const blob = `${err.stdout ?? ''}${err.stderr ?? ''}`
    // A package that has never been published is a legitimate `free`, and it is
    // the ONLY error we are willing to read as good news.
    if (/E404|404 Not Found|is not in this registry/.test(blob)) return { name: pkg.name, state: 'unpublished' }
    return { name: pkg.name, state: 'unknown', why: (blob.split('\n').find((l) => l.trim()) ?? err.message).trim() }
  }
}

const results = await Promise.all(pkgs.map(check))

for (const r of results) {
  const mark = { free: '·', unpublished: '·', published: '✗', unknown: '?' }[r.state]
  const say = {
    free: `${target} is free`,
    unpublished: 'never published — free',
    published: `ALREADY PUBLISHED at ${target}`,
    unknown: `COULD NOT DETERMINE — ${r.why}`,
  }[r.state]
  console.log(`  ${mark} ${r.name.padEnd(26)} ${say}`)
}

const published = results.filter((r) => r.state === 'published')
const unknown = results.filter((r) => r.state === 'unknown')

// Report the unanswerable BEFORE the answered. An unknown is not a pass, and
// ordering it last is how it gets skimmed past.
if (unknown.length) {
  console.error(`\n? ${unknown.length} package(s) could not be checked. This is NOT a pass.`)
  console.error('  The registry did not answer. Re-run; do not publish on this result.')
  process.exit(2)
}
if (published.length) {
  console.error(`\n✗ ${published.length} of ${results.length} package(s) already carry ${target}.`)
  console.error('  Publishing this version is EPUBLISHCONFLICT. Choose a version npm does not hold,')
  console.error('  and check whether another repo shipped this line — it has happened here before.')
  process.exit(1)
}
console.log(`\n✓ no package carries ${target}; the version is free to publish`)
