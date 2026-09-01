#!/usr/bin/env node
//
// check-codemod-rows — this repo answers for the codemod rows that name ITS packages.
//
// WHY IT LIVES HERE. `@noy-db/hub` ships migration maps under `codemods/`, and
// hub's own suite used to check every row against the source of the package it
// names. When this family was extracted on 2026-09-01 those packages left, so
// hub can no longer answer for them. It did NOT silently skip them — a suite
// reporting "22 rows checked" while examining three is worse than one that
// fails — it DECLARED the extraction and asserted the declaration both ways.
// The other half of that arrangement is this file: the receiving repo verifies
// its own rows.
//
// A codemod row is a promise to a consumer migrating versions: "`from` became
// `to` in this package". Nothing compiles a migration map. If a rename is later
// reverted or renamed again, the row goes quietly wrong and the first person to
// discover it is a consumer following it.
//
//   node scripts/check-codemod-rows.mjs
//
// Reads the maps from the INSTALLED @noy-db/hub, never from a copy — a vendored
// map is a second source of truth that drifts silently, which is the class of
// defect this repo already carries scars from.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Resolve hub from any package that declares it — this repo's root does not.
const pkgDirs = readdirSync(ROOT).filter((d) => existsSync(join(ROOT, d, 'package.json')) && !d.startsWith('.'))
let codemodDir = null
for (const d of pkgDirs) {
  try {
    const req = createRequire(join(ROOT, d, 'package.json'))
    // NOT `resolve('@noy-db/hub/package.json')` — hub's exports map does not
    // expose it, and that throws ERR_PACKAGE_PATH_NOT_EXPORTED. Resolve the
    // entry point and walk up to the package root instead.
    let dir = dirname(req.resolve('@noy-db/hub'))
    for (let i = 0; i < 5 && dir !== '/'; i++) {
      if (existsSync(join(dir, 'package.json')) && basename(dir) === 'hub') break
      dir = dirname(dir)
    }
    codemodDir = join(dir, 'codemods')
    if (existsSync(codemodDir)) break
    codemodDir = null
  } catch { /* keep looking */ }
}
if (!codemodDir) {
  console.error('✗ cannot resolve @noy-db/hub — run `pnpm install` first')
  process.exit(2)
}

const localPackages = new Map(
  pkgDirs
    .map((d) => [JSON.parse(readFileSync(join(ROOT, d, 'package.json'), 'utf8')).name, d])
    .filter(([name]) => name?.startsWith('@noy-db/')),
)

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.ts')) out.push(p)
  }
  return out
}

const problems = []
let checked = 0
const maps = readdirSync(codemodDir).filter((f) => f.endsWith('.json'))

for (const file of maps) {
  const map = JSON.parse(readFileSync(join(codemodDir, file), 'utf8'))
  for (const row of map.renames ?? []) {
    const dir = localPackages.get(row.package)
    if (!dir) continue // another repo answers for this row
    // `option-key` and `method` name a field on an options bag and a getter on a
    // class — neither is an export, so an export-surface assertion would call
    // them wrong. Only identifier/type rows are answerable this way.
    if (row.kind !== 'identifier' && row.kind !== 'type') continue

    const source = walk(join(ROOT, dir, 'src')).map((f) => readFileSync(f, 'utf8')).join('\n')
    checked++
    const wordRe = (w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)

    // The NEW name must be present — UNLESS `toPackage` says ownership moved to
    // another package. `AsCSVImportOptions -> FormatImportOptions` carries
    // `toPackage: "@noy-db/hub/as"`, so the type is hub's now and its absence
    // here is CORRECT, not a defect.
    if (row.to && !row.toPackage && !wordRe(row.to).test(source))
      problems.push(`${file} · ${row.package}: promises "${row.from}" → "${row.to}", but "${row.to}" appears nowhere in ${dir}/src`)

    // The OLD name must be gone — but ONLY for rows the map itself marks
    // `safeGlobalReplace`. The others are BARE NOUNS (`toString`, `fromString`,
    // `fromObject`) that mean something else elsewhere: `toString` is a
    // JavaScript builtin, so a word-boundary match hits `obj.toString()` in any
    // file. The map annotates its own unsafe entries precisely so a consumer
    // does not blanket-replace them, and a checker that ignores the annotation
    // reports four confident false positives — which is exactly what the first
    // version of this file did.
    if (row.from && row.safeGlobalReplace === true && wordRe(row.from).test(source))
      problems.push(`${file} · ${row.package}: promises "${row.from}" was renamed, but "${row.from}" is STILL present in ${dir}/src`)
  }
}

if (problems.length) {
  console.error(`\n✗ ${problems.length} codemod row(s) disagree with this repo's source:\n`)
  for (const p of problems) console.error(`   ${p}`)
  console.error('\nA migration map is a promise to a consumer following it, and nothing compiles it.\nEither the source drifted or the row is wrong — fix whichever is actually untrue.\n')
  process.exit(1)
}

console.log(`✓ ${checked} codemod row(s) naming this repo's packages agree with its source (${maps.length} map(s) read from the installed @noy-db/hub)`)
