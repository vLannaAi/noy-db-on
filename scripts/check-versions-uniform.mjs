#!/usr/bin/env node
//
// check-versions-uniform — the guard against a PARTIAL bump.
//
// WHY THIS EXISTS.
//
// The family's most expensive recurring defect is a version line moved for
// SOME of its members. It has arrived by several mechanisms: `workspace:*` in
// peerDependencies publishing as an EXACT version, so bumping one sibling
// shipped a peer requirement for a version that DOES NOT EXIST (noy-db #1228);
// a dev-pin sweep that missed a straggler because the author re-read the bump
// script instead of grepping for the old string; two satellites from different
// cuts becoming mutually uninstallable by name.
//
// Every one of those passed every in-repo gate. They are invisible to a test
// suite by construction — a suite resolves workspace source and never has to
// satisfy a published range.
//
// ⚠️ ASSERT ON THE OUTPUT DOMAIN. This checks PROPERTIES ("all versions are
// equal", "the dev pin satisfies the declared peer range"), not an enumeration
// of the version strings we happen to expect today. A pinned-version assertion
// is one you edit routinely, and one you edit routinely is one you stop
// reading.
//
// ⚠️ AND IT REPORTS COUNTS, never absence-of-error. This repo has zero internal
// dependency edges, so that pass is currently VACUOUS. A vacuous check that
// prints nothing is indistinguishable from one that did work — see the family's
// `observedClientGenerations` incident, a field that shipped empty and stayed
// empty for three milestones because nothing ever said it was empty.
//
//   node scripts/check-versions-uniform.mjs
//
// Exit 1 on any skew.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

const pkgs = readdirSync(ROOT)
  .filter((d) => !d.startsWith('.') && d !== 'node_modules' && d !== 'scripts')
  .filter((d) => existsSync(join(ROOT, d, 'package.json')))
  .sort()
  .map((d) => readJson(join(ROOT, d, 'package.json')))

const names = new Set(pkgs.map((p) => p.name))
const failures = []

// ── 1. every package carries the same version ────────────────────────────────
const versions = new Map()
for (const p of pkgs) {
  if (!versions.has(p.version)) versions.set(p.version, [])
  versions.get(p.version).push(p.name)
}
if (versions.size !== 1) {
  failures.push('package versions are not uniform:')
  for (const [v, who] of [...versions].sort()) failures.push(`    ${v}  ${who.join(', ')}`)
}
const common = versions.size === 1 ? [...versions.keys()][0] : null

// --expect <version>: the release gate. The ported gate compared a release tag
// against the ROOT manifest's version — the lockstep canonical in noy-db-to,
// whose root carries one. THIS root is `private` and versionless, so that
// expression yielded the STRING "undefined" and the gate could NEVER pass for
// any tag. A premise true where it was written and false where it was pasted;
// measured 2026-09-01, before it had ever run. Asserting here instead keeps the
// version logic in one place, and asserts the property directly: every package
// equals the tag, not merely equals each other.
const expectIdx = process.argv.indexOf('--expect')
const expected = expectIdx === -1 ? null : process.argv[expectIdx + 1]
if (expectIdx !== -1 && !expected) {
  console.error('✗ --expect needs a version')
  process.exit(1)
}
if (expected) {
  const off = pkgs.filter((p) => p.version !== expected)
  if (off.length) {
    for (const p of off) failures.push(`${p.name} is at ${p.version}, but ${expected} was expected`)
  }
  console.log(`expected      ${expected} — ${pkgs.length - off.length}/${pkgs.length} package(s) match`)
}
console.log(`versions      ${pkgs.length} package(s), ${versions.size} distinct${common ? ` — all at ${common}` : ''}`)

// ── 2. every INTERNAL range admits the common version ────────────────────────
let internalEdges = 0
for (const p of pkgs) {
  for (const field of ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [dep, range] of Object.entries(p[field] ?? {})) {
      if (!names.has(dep)) continue
      internalEdges++
      if (common && !semver.satisfies(common, range, { includePrerelease: true })) {
        failures.push(`${p.name} ${field}.${dep} = "${range}" does not admit ${common}`)
      }
    }
  }
}
console.log(
  `internal      ${internalEdges} edge(s) between packages in this repo` +
    (internalEdges === 0 ? '  (vacuous today — this repo has none)' : ''),
)

// ── 3. every EXTERNAL @noy-db/* specifier is uniform across declarers ────────
// The lockstep line must move as a UNIT. A straggler here is the #1228 shape:
// locally correct, green in every suite, and an ERESOLVE for the consumer.
const external = new Map() // "field @dep" -> Map(range -> [pkg])
for (const p of pkgs) {
  for (const field of ['dependencies', 'peerDependencies', 'devDependencies']) {
    for (const [dep, range] of Object.entries(p[field] ?? {})) {
      if (!dep.startsWith('@noy-db/') || names.has(dep)) continue
      const key = `${field} ${dep}`
      if (!external.has(key)) external.set(key, new Map())
      const byRange = external.get(key)
      if (!byRange.has(range)) byRange.set(range, [])
      byRange.get(range).push(p.name)
    }
  }
}
for (const [key, byRange] of [...external].sort()) {
  const declarers = [...byRange.values()].flat().length
  console.log(`lockstep      ${key.padEnd(34)} ${byRange.size} distinct range(s) across ${declarers} package(s)`)
  if (byRange.size !== 1) {
    failures.push(`${key} is not uniform — the line did not move as a unit:`)
    for (const [range, who] of byRange) failures.push(`    "${range}"  ${who.join(', ')}`)
  }
}

// ── 4. an exact dev pin must satisfy the peer range declared beside it ───────
// The proxy table's row: the dev pin is not the declared peer range. A package
// can typecheck green against a pin its own published range would not admit.
for (const p of pkgs) {
  for (const [dep, pin] of Object.entries(p.devDependencies ?? {})) {
    const range = p.peerDependencies?.[dep]
    if (!range || !semver.valid(pin)) continue
    if (!semver.satisfies(pin, range, { includePrerelease: true })) {
      failures.push(`${p.name} dev-pins ${dep}@${pin}, which its own peer range "${range}" does not admit`)
    }
  }
}

if (failures.length) {
  console.error('\n✗ version skew:')
  for (const f of failures) console.error(`  ${f}`)
  process.exit(1)
}
console.log('\n✓ one version across every package; lockstep ranges uniform; dev pins admitted by their peer ranges')
