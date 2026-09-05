#!/usr/bin/env node
/**
 * scripts/align-dist-tags.mjs
 *
 * After a STABLE publish, point `next` at the stable too.
 *
 * ## Why
 *
 * `release.yml` routes an unmarked GitHub Release to `--tag latest`. That sets
 * `latest` to the stable and LEAVES `next` on the last pre-release — and
 * `0.6.0 > 0.6.0-pre.7`, so `@next` ends up BEHIND `@latest`. That is the
 * "lying tag" state the family sweep flags: `@next` is supposed to be the
 * in-flight channel, ahead of or equal to `@latest`, never behind.
 *
 * Aligning both tags on the stable is self-correcting — the next pre-release
 * moves `next` forward again and the normal invariant returns.
 *
 * ## This is the MIRROR of noy-db's scripts/repoint-pre-only-latest.mjs
 *
 * That script moves `latest` for packages that have no stable at all. This one
 * moves `next` for packages that just got one. Read it before changing this —
 * but do NOT copy two of its choices, both deliberate there and wrong here:
 *
 *   1. It carries a HARDCODED package list (`PRE_ONLY`), currently empty, so it
 *      is a no-op until someone remembers to add a name. ⚠️ The scar that argues
 *      against it is noy-db-to's, not this repo's — the ported text told it as
 *      local history. There, the docs-bridge WIRING table was a hardcoded list,
 *      `to-browser-fs` debuted as the 18th store and was never added, and the
 *      bridge threw on TWO releases while both runs reported success. The
 *      lesson transfers even though the incident is not ours, and this repo has
 *      its own instance of the same class: release.yml shipped a docs-bridge
 *      job whose payload script was never extracted, so it could only ever fail
 *      inside a green run. We DERIVE the list from the filesystem instead.
 *
 *   2. It never fails its caller, on the reasoning that a wedged tag is
 *      cosmetic and a red release trains people to stop reading logs. That is
 *      right for a pre-only repoint. It is wrong here: a package left behind
 *      leaves `@next` pointing at something older than `@latest`, which is a
 *      wrong answer to `npm i @noy-db/to-x@next`, not a cosmetic one. This
 *      script EXITS NON-ZERO on any failure.
 *
 * ## Usage
 *
 *   node scripts/align-dist-tags.mjs --version=0.6.0 [--dry-run]
 *
 * Requires NODE_AUTH_TOKEN — the CI automation token bypasses 2FA. A
 * workstation `npm dist-tag add` needs an interactive OTP and cannot be
 * scripted. (`npm deprecate` is a DIFFERENT endpoint and has not been tested
 * this way; do not assume it behaves the same.)
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, existsSync, readFileSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')

// Importing this module must not read the registry or write a tag. Only the
// pure derivation is exported; everything below `isMain` is the execute half.
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

/** Derived, never transcribed. A new store is covered the day it exists. */
export function publishedPackages() {
  return readdirSync(ROOT)
    .filter(d => d.startsWith('on-') && existsSync(join(ROOT, d, 'package.json')))
    .map(d => JSON.parse(readFileSync(join(ROOT, d, 'package.json'), 'utf8')))
    .filter(pj => pj.private !== true)
    .map(pj => pj.name)
    .sort()
}

/**
 * Decide what to do with one package, from its current dist-tags alone.
 *
 * Pure, and exported ONLY so the refusal can be tested. `latest` must ALREADY
 * be the target: the stable publish sets it, so if it is not there this is
 * running against the wrong `--version`, or before the publish landed. A blind
 * `dist-tag add <pkg>@<version> next` is correct when the stable really
 * published and CATASTROPHIC when the version input is wrong — it would move
 * the in-flight channel onto a version that may not exist.
 *
 * @param {{latest?: string, next?: string}} tags
 * @param {string} version
 * @returns {{action: 'refuse'|'skip'|'move', reason: string}}
 */
export function decideAction(tags, version) {
  if (tags?.latest !== version) {
    return { action: 'refuse', reason: `\`latest\` is ${tags?.latest ?? '<none>'}, expected ${version}. Did the stable publish?` }
  }
  if (tags.next === version) return { action: 'skip', reason: 'already aligned' }
  return { action: 'move', reason: `${tags.next ?? '<none>'} → ${version}` }
}

if (!isMain) { /* imported for the pure helpers — stop here */ } else {

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const version = args.find(a => a.startsWith('--version='))?.slice('--version='.length)
const settleMs = Number(args.find(a => a.startsWith('--settle-ms='))?.slice('--settle-ms='.length) ?? 15000)
const attempts = Number(args.find(a => a.startsWith('--attempts='))?.slice('--attempts='.length) ?? 4)

const summary = []
const note = (l) => { console.log(`[align] ${l}`); summary.push(l) }
const hardFail = (m) => { console.error(`[align] \u2717 ${m}`); summary.push(`\u2717 ${m}`); process.exitCode = 1 }
/** Synchronous sleep — this script is sync throughout and settling is the point. */
const sleep = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`[align] --version must be a STABLE semver, got: ${version ?? '<missing>'}`)
  console.error('[align] a pre-release needs no alignment — publishing one already sets `next`.')
  process.exit(1)
}

// npm reports write-path auth failures as 404, never 401 — deliberately, so status
// codes cannot probe which private packages exist. Establish identity first, or a
// later 404 is ambiguous between "bad token" and "no such package".
try {
  note(`npm user: \`${execFileSync('npm', ['whoami'], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim()}\``)
} catch {
  console.error('[align] \u2717 `npm whoami` failed — the token is missing or invalid.')
  console.error('[align]   Every later failure would surface as a 404 and look like a missing package.')
  process.exit(1)
}

const readTags = (pkg) => JSON.parse(execFileSync('npm', ['view', pkg, 'dist-tags', '--json'],
  { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }))

const pkgs = publishedPackages()
note(`aligning \`next\` \u2192 \`${version}\` for ${pkgs.length} derived packages${dryRun ? ' (dry run)' : ''}`)

// ── PHASE 1: decide and write ────────────────────────────────────────────────
const wrote = []
const writeFailed = []
for (const pkg of pkgs) {
  let tags
  try { tags = readTags(pkg) } catch { hardFail(`\`${pkg}\` — cannot read dist-tags`); continue }

  const d = decideAction(tags, version)
  if (d.action === 'refuse') { hardFail(`\`${pkg}\` — refusing: ${d.reason}`); continue }
  if (d.action === 'skip')   { note(`- \`${pkg}\` — ${d.reason}`); continue }
  if (dryRun)                { note(`- \`${pkg}\` — would move \`next\`: ${d.reason}`); continue }

  try {
    execFileSync('npm', ['dist-tag', 'add', `${pkg}@${version}`, 'next'], { stdio: 'pipe' })
    wrote.push({ pkg, from: tags.next })
  } catch (err) {
    writeFailed.push({ pkg, detail: (err?.stderr?.toString() ?? err?.message ?? '').split('\n')[0] })
  }
}

// ── PHASE 2: confirm, with settling ──────────────────────────────────────────
//
// ⛔ THE RETRY LOOP IS THE MECHANISM. THE TWO-PASS SPLIT IS NOT.
//
// It is tempting to read the write/confirm separation as the fix, because it is
// the structurally satisfying half. Porting it without a retry budget that can
// outlast the cache lands STRICTLY WORSE than the original — the same shape as
// porting a changelog parser without checking the heading style it matches.
//
// HOW MUCH SETTLING THE SPLIT ACTUALLY BUYS (derivation from the code, not a
// measurement — the fixed design has never run on a real cut):
//
//   with n packages, write time w, read time r, and BOTH PASSES IN THE SAME
//   ORDER, package i is written at i·w and read at n·w + i·r, so
//
//     settle(i) = n·w + i·(r − w)      i=1 → n·w      i=n → n·r
//
//   r ≈ w for npm calls, so settle is roughly ONE PASS-DURATION for every
//   package, with a floor of n·r. That scales WITH package count:
//
//     52 packages → ~80s     18 (here) → ~27s     3 → ~4.5s
//
// So the exposure here is that this repo is EIGHTEEN, not that it is
// tail-shaped. An earlier draft of this comment claimed the last-written
// package gets essentially zero settle; that is false for this design and was
// reasoning about an ordering nobody had read. It IS true of a
// verify-inline-per-package design, which is what noy-db shipped and what broke.
//
// ⚠️ THE INVARIANT THAT MAKES THE ABOVE HOLD IS UNSTATED ANYWHERE ELSE AND
// PINNED BY NO TEST: both passes must run in the SAME ORDER. Phase 1 pushes in
// `pkgs` order; `Array.prototype.filter` below preserves it. Reverse the read
// loop for a good-looking reason — or parallelise it — and the tail silently
// goes to zero, which is exactly the failure the earlier draft imagined.
// The retry budget is what makes that not matter, which is the real argument
// for sizing it independently of package count.
//
const stillStale = ({ pkg }) => { try { return readTags(pkg).next !== version } catch { return true } }

// Check once for free before waiting — most packages confirm immediately and
// should cost nothing. Only then start burning the retry budget.
let pending = wrote.filter(stillStale)
for (let i = 1; i <= attempts && pending.length; i++) {
  note(`  ${pending.length} not yet visible — settling ${settleMs}ms (attempt ${i}/${attempts})`)
  sleep(settleMs)
  pending = pending.filter(stillStale)
}

for (const { pkg, from } of wrote) {
  if (!pending.some(p => p.pkg === pkg)) note(`- \`${pkg}\` — \`next\`: ${from} \u2192 ${version} \u2713 confirmed`)
}

// ── Classify. "could not confirm" is NOT "failed" — opposite instructions ─────
for (const { pkg, detail } of writeFailed) hardFail(`\`${pkg}\` — dist-tag add FAILED: ${detail}`)

if (pending.length) {
  note('')
  note(`\u26a0\ufe0f ${pending.length} package(s) written but NOT CONFIRMED after ${attempts} attempts:`)
  for (const { pkg } of pending) note(`   - \`${pkg}\``)
  note('')
  note('The `dist-tag add` for these reported SUCCESS. `npm view` is CDN-served and')
  note('can lag a write by minutes, so this is most likely propagation, not failure.')
  note('**CHECK before repairing** — re-running a repair on a correct tag is how a')
  note('good release gets hand-edited into a bad one:')
  for (const { pkg } of pending) note(`   npm view ${pkg} dist-tags`)
}

if (process.env['GITHUB_STEP_SUMMARY']) {
  const head = process.exitCode
    ? '### \u26a0\ufe0f dist-tag alignment FAILED'
    : pending.length ? '### dist-tag alignment — written, confirmation pending' : '### dist-tag alignment'
  appendFileSync(process.env['GITHUB_STEP_SUMMARY'], `${head}\n\n${summary.join('\n')}\n\n`)
}

// Exit non-zero ONLY for writes that actually failed. An unconfirmed write is
// reported loudly and does not fail the job: the write returned success, and
// the read is the unreliable half.
if (writeFailed.length) {
  console.error('[align] one or more dist-tag writes FAILED — those packages need repair:')
  for (const { pkg } of writeFailed) console.error(`[align]   npm dist-tag add ${pkg}@${version} next`)
}
}
