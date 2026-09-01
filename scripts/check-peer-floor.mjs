// check-peer-floor — does every package actually COMPILE against the oldest
// @noy-db/hub its peer range admits?
//
// Why this exists, and why it is separate from check-architecture.mjs:
//
// `hub-peer-range` in check-architecture asserts the peer is *a range*. It
// cannot assert the range is *true*, because truth requires resolving symbols
// out of a hub version that is not installed. Every other gate in this repo —
// build, lint, typecheck, 224 tests — runs against the DEV PIN, so all of them
// stay green no matter how wrong the declared range is. The dev pin is a proxy
// for the range, and it always answers reassuringly.
//
// ⚠️ THE TWO INCIDENTS BELOW ARE noy-db-to's, NOT THIS REPO'S. The ported header
// told them as local history; they are about to-postgres / to-drive / to-icloud,
// packages this repo does not contain. The MECHANISM is what transfers and it
// transfers exactly — which is why these stay here, corrected rather than
// deleted. Deleting them would throw away the reasoning along with the
// misattribution, and the reasoning is the entire argument for compiling
// instead of grepping.
//
//   noy-db-to #89  16 packages advertised ^0.3.0 || ^0.4.0 || ^0.5.0 while
//        importing StoreLocator / StoreDescriptor / StoreFactory, which exist
//        only from 0.6.0-pre. `npm i @noy-db/to-postgres @noy-db/hub` satisfied
//        the peer check and then failed to typecheck. That defect was live on
//        noy-db-to's 0.5.0 stable line and was repaired by deprecating 17
//        versions. ⚠️ That "17" is the origin of a number that then travelled:
//        release.yml borrowed it and re-pointed it at on-*@0.5.0, where every
//        clause was false. Fixing the copy while this source stood is how it
//        would have come back on the next port.
//
//   noy-db-to #84  to-drive / to-icloud register a NoydbPodStore factory
//        without a cast, which needs StoreLocator.register() to be generic over
//        both store shapes — landed in 0.6.0-pre.11. SYMBOL PRESENCE DOES NOT
//        CATCH THIS: StoreFactory exists at 0.6.0-pre.0, it just cannot accept
//        the argument. Only compiling against the floor finds it. This is the
//        proxy table's "symbol presence vs does the signature accept the
//        argument" row, and it is why this check exists at all.
//
// So this check COMPILES; it does not grep. That distinction is the whole
// point and should not be optimised away.
//
// Cost: one `pnpm install` per DISTINCT floor (currently ONE — all six
// hub-binding packages declare ^0.7.0), not per package.
// Intended for CI, not for the lint path — it needs the network.
//
// Usage:  node scripts/check-peer-floor.mjs
//         node scripts/check-peer-floor.mjs --dry-run   (print the plan, install nothing)

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')
const DRY = process.argv.includes('--dry-run')

// Importing this file must not install anything — the pure "plan" half is unit
// tested, the "execute" half (install + build + typecheck) is what the CI job
// proves. Only `main()` runs under this guard.
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

// semver is not a direct dependency; resolve it from wherever pnpm put it.
const require = createRequire(import.meta.url)
let semver
try {
  semver = require('semver')
} catch {
  const dir = readdirSync(join(ROOT, 'node_modules/.pnpm')).find((d) => d.startsWith('semver@'))
  if (!dir) {
    console.error('✗ semver not found — add it as a devDependency of the repo root.')
    process.exit(1)
  }
  semver = require(join(ROOT, 'node_modules/.pnpm', dir, 'node_modules/semver'))
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

export function packageDirs() {
  return readdirSync(ROOT)
    .filter((d) => d.startsWith('on-'))
    .map((d) => join(ROOT, d))
    .filter((d) => statSync(d).isDirectory() && existsSync(join(d, 'package.json')))
}

/**
 * The lowest version a range admits, or `null` if there is no such version.
 *
 * `semver.minVersion` fails in TWO different ways and only one of them is a
 * return value:
 *
 *   minVersion('not-a-range')   → THROWS TypeError: Invalid comparator
 *   minVersion('>1.0.0 <1.0.0') → returns null   (well-formed, unsatisfiable)
 *
 * The original `minVersion(range)?.version` handled the null and let the throw
 * escape, so a MALFORMED range — the case the error message below was written
 * for — killed the script with a raw stack trace naming neither the package nor
 * the range, and the friendly branch was unreachable. The null path kept the
 * branch looking exercised. Found across klum-db, doi-db and here.
 *
 * There is a THIRD failure that is neither: an UNBOUNDED range.
 *
 *   minVersion('') === minVersion('   ') === minVersion('*') === minVersion('x')
 *     → 0.0.0
 *
 * No @noy-db package has ever published 0.0.0. That neither throws nor returns
 * null, so it silently plans a check against a version that does not exist and
 * fails minutes later at the install step as "no matching version for
 * @noy-db/hub@0.0.0" — which reads as a registry problem rather than a
 * malformed manifest. Worse here than elsewhere: this guard groups by DISTINCT
 * floor, so one such package invents a phantom 0.0.0 group and the failure is
 * attributed to the group rather than to the package that caused it.
 *
 * The honest reason to reject it: an unbounded range promises EVERY version, so
 * there is no floor that could test it. It is not malformed — it is
 * unfalsifiable. `validRange` normalises all five spellings to '*'.
 *
 * NOTE for refactors: `^0.6.0-pre.0` must floor at `0.6.0-pre.0`, NOT `0.6.0`.
 * Every range in this repo is a pre-release range; flooring at the release
 * would test a HIGHER version than the range admits, so a range that is false
 * for pre-releases would pass. The two values look alike at a glance.
 */
export function floorOf(range) {
  try {
    if (semver.validRange(range) === '*') return null
    return semver.minVersion(range)?.version ?? null
  } catch {
    return null
  }
}

/**
 * The root package.json text with `pnpm.overrides['@noy-db/hub']` pinned to
 * `floor`. Pure: takes and returns text, so the caller keeps the ORIGINAL
 * bytes and restores them verbatim rather than re-serialising.
 */
export function pinnedRootText(originalText, floor) {
  const pj = JSON.parse(originalText)
  pj.pnpm = { ...(pj.pnpm ?? {}), overrides: { ...(pj.pnpm?.overrides ?? {}), '@noy-db/hub': floor } }
  return JSON.stringify(pj, null, 2) + '\n'
}

// ── Plan: group packages by the minimum hub version their range admits ──────
export function planGroups() {
  const groups = new Map() // floor -> [{name, dir, range}]
  for (const dir of packageDirs()) {
    const pj = readJson(join(dir, 'package.json'))
    const range = pj.peerDependencies?.['@noy-db/hub']
    // ⚠️ NOT "check-architecture already failed this" — that was true in
    // noy-db-to, where every store binds /to. HERE three packages
    // (on-email-otp, on-threat, on-totp) import hub NOWHERE, and
    // check-architecture's rule deliberately exempts them (see its line 68).
    // So a package with no hub peer is LEGITIMATE, not already-rejected, and
    // this skip is correct for a different reason than the ported comment gave.
    // Do not "fix" this into a hard failure: it would break three packages that
    // owe no peer.
    if (!range) continue
    const floor = floorOf(range)
    if (!floor) {
      console.error(`✗ ${pj.name}: no floor to check "${range}" against.`)
      console.error(`    An unbounded range (*, x, blank) promises every version, so nothing`)
      console.error(`    falsifies it. A malformed or unsatisfiable range has no minimum at all.`)
      console.error(`    Declare a real floor, e.g. "^0.6.0-pre.0".`)
      process.exit(1)
    }
    if (!groups.has(floor)) groups.set(floor, [])
    groups.get(floor).push({ name: pj.name, dir, range })
  }
  return groups
}

function main() {
const groups = planGroups()

// Report what was actually GROUPED, not how many packages exist. A package with
// no hub peer is skipped above — legitimately, because it imports hub nowhere —
// and printing the directory count would claim coverage this run does not have.
// The "(N skipped — no peer range)" suffix is load-bearing here: three of nine
// are expected to be skipped forever, so a reader must be able to tell that
// from a peer range that went missing by accident.
const checked = [...groups.values()].reduce((n, pkgs) => n + pkgs.length, 0)
const total = packageDirs().length
const scope = checked === total ? `${total} packages` : `${checked} of ${total} packages (${total - checked} skipped — no peer range)`
console.log(`Peer-floor check — ${groups.size} distinct floor(s) across ${scope}\n`)
for (const [floor, pkgs] of groups) {
  console.log(`  @noy-db/hub@${floor}`)
  for (const p of pkgs) console.log(`     ${p.name.padEnd(28)} ${p.range}`)
}
console.log()

if (DRY) {
  console.log('--dry-run: nothing installed.')
  process.exit(0)
}

// ── Execute: override hub to each floor in turn and typecheck that group ────
//
// The root pnpm.overrides entry is the least invasive way to force a specific
// hub across the workspace while reusing each package's own tsconfig. The root
// package.json is restored in `finally`, so an interrupted run does not leave a
// pinned override behind.
const rootPath = join(ROOT, 'package.json')
const rootOriginal = readFileSync(rootPath, 'utf8')
const failures = []

const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', env: process.env })

try {
  for (const [floor, pkgs] of groups) {
    console.log(`── installing @noy-db/hub@${floor} …`)
    writeFileSync(rootPath, pinnedRootText(rootOriginal, floor))

    try {
      run('pnpm', ['install', '--no-frozen-lockfile', '--silent'])
    } catch (e) {
      // A floor that cannot even be installed is itself a failed claim.
      failures.push({ floor, pkgs: pkgs.map((p) => p.name), error: `install failed: ${e.stderr || e.message}` })
      continue
    }

    // Build the group AND its workspace dependencies first. Several packages
    // import a sibling (to-cloudflare-r2 → to-aws-s3, to-supabase →
    // to-postgres) and resolve it through the workspace link, whose `types`
    // field points into dist/. Without this the typecheck fails with TS2307
    // "Cannot find module" — which looks exactly like a peer-range failure and
    // is not one. The `...` suffix pulls in each package's workspace deps, so
    // the build stays inside this group's floor rather than rebuilding packages
    // that declare a different one.
    const buildFilters = pkgs.flatMap((p) => ['--filter', `${p.name}...`])
    try {
      run('pnpm', [...buildFilters, 'build'])
    } catch (e) {
      // A group that cannot even build at its floor is a failed claim too —
      // but report it as a build failure so it is not mistaken for a type error.
      failures.push({
        floor,
        pkgs: pkgs.map((p) => p.name),
        error: `build failed at this floor:\n      ${`${e.stdout ?? ''}${e.stderr ?? ''}`.slice(0, 500)}`,
      })
      continue
    }

    for (const p of pkgs) {
      process.stdout.write(`   typecheck ${p.name.padEnd(28)} `)
      try {
        run('pnpm', ['--filter', p.name, 'typecheck'])
        console.log('ok')
      } catch (e) {
        console.log('FAILED')
        const out = `${e.stdout ?? ''}${e.stderr ?? ''}`
        const errs = out.split('\n').filter((l) => /error TS/.test(l)).slice(0, 4)
        failures.push({ floor, pkgs: [p.name], range: p.range, error: errs.join('\n      ') || out.slice(0, 400) })
      }
    }
  }
} finally {
  writeFileSync(rootPath, rootOriginal)
  try {
    run('pnpm', ['install', '--no-frozen-lockfile', '--silent'])
  } catch {
    console.error('\n⚠  restore install failed — run `pnpm install` before committing.')
  }
}

console.log()
if (failures.length) {
  console.error(`✗ ${failures.length} package(s) do not compile against the floor they advertise:\n`)
  for (const f of failures) {
    console.error(`  ${f.pkgs.join(', ')}  declares "${f.range}"  → floor @noy-db/hub@${f.floor}`)
    console.error(`      ${f.error}\n`)
  }
  console.error('Either narrow the peer range to a floor that works, or restore compatibility')
  console.error('with the older hub. A range that does not compile is a false promise —')
  console.error('consumers hit it as a broken install, not as a refused one.')
  process.exit(1)
}
console.log('✓ every package compiles against the oldest @noy-db/hub its peer range admits')
}

if (isMain) main()
