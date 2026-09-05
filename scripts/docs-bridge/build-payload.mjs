#!/usr/bin/env node
//
// build-payload — emit the machine-readable release payload (docs-bridge.json)
// that noy-db-docs' range walk reads for the `on` partition.
//
// Contract: noy-db-docs/docs/superpowers/specs/2026-09-05-as-on-at-doc-sync-sources-design.md
//
// ⚠️ WHAT THIS DELIBERATELY DOES NOT EMIT: `shape`, `capabilities`, `txAtomic`,
// `conditionalBits`. Those are read ONLY by `checkBridgeDivergence`, which is
// called only from noy-db-to's static capability scan and refuses any other
// repo's payload (spec §3.2). No `on-*` package is a store. Emitting them would
// be inventing facts for a gate that will never read them.
//
// ⚠️ AND WHAT IT EMITS THAT NOTHING READS: `channel`, `runUrl`, per-package
// `version`, `description`, `hubPeerRange` (spec §3.3). Kept because the asset
// is also opened by hand, and `hubPeerRange` is exactly the fact a docs reader
// wants from this repo. Do not "clean these up".
//
// ⭐ THE TOP-LEVEL `changelog` IS THIS REPO'S ONLY PROSE, and it is why it is
// here rather than per package. The three monorepo producers (noy-db,
// noy-db-ui) get a per-package CHANGELOG.md from changesets. This repo has NONE
// — measured, all ten packages — because it releases as one lockstep unit and
// keeps a single root CHANGELOG.md. So the spec's per-package `updated` clause
// can never fire here and every entry is honestly `version-only`.
//
// Copying the root section into all ten entries was considered and REJECTED: a
// release-scoped narrative ("these packages shipped from core, not from here")
// is not something ten packages each said, and attributing it to each of them
// asserts a true sentence in a field that means something else. The prose rides
// at the top level, where its scope matches its content.
//
// ⚠️ `parseBridge` tolerates unknown top-level keys — verified in the consumer's
// own source (`scripts/sync/bridge.mjs`: it checks `bridge === 1`,
// `Array.isArray(packages)`, optionally `repo`, then returns the object; there
// is no key enumeration anywhere in the file). So this field is INERT until the
// consumer is taught it, and legible to a human opening the JSON meanwhile.
// If that ever becomes a strict parse, this field is the thing that breaks.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const REPO = 'vLannaAi/noy-db-on'

/** The `## <version>` section of a CHANGELOG, verbatim, or null. */
export function extractSection(changelogText, version) {
  const lines = changelogText.split('\n')
  const start = lines.findIndex(l => l.trim() === `## ${version}`)
  if (start === -1) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { end = i; break }
  }
  return lines.slice(start + 1, end).join('\n').trim() || null
}

/**
 * True when a failed `npm view` means the package has never been published
 * (npm's E404). Any other failure — network blip, registry outage, auth — is
 * NOT first-publish. Mislabelling one tells docs to write a brand-new page for
 * a package that has shipped for months, so the caller rethrows instead of
 * guessing.
 */
export function isFirstPublishFromError(err) {
  const text = `${err?.stderr ?? ''}${err?.stdout ?? ''}`.toString()
  return text.includes('E404')
}

/**
 * True when npm knows no version of this package other than the one just cut.
 *
 * ⚠️ THE REGISTRY IS THE SOURCE, NOT THIS REPO'S HISTORY, and `on-shamir` is
 * exactly why that distinction is load-bearing. It arrived here in 0.7.1-pre.0
 * having been published from noy-db since 0.1.0-pre.3, so it is NEW TO THIS
 * REPO and old to npm. `collapseBridges` sets `firstSeen` from the first
 * `added`, so calling it `added` would tell docs the package first appeared at
 * 0.7.1-pre.N. The publisher changed; the package did not.
 */
export function npmIsFirstPublish(name) {
  try {
    const out = execFileSync('npm', ['view', name, 'versions', '--json'], { stdio: 'pipe' }).toString()
    const versions = JSON.parse(out)
    const list = Array.isArray(versions) ? versions : [versions]
    return list.length <= 1
  } catch (err) {
    if (isFirstPublishFromError(err)) return true // not on the registry at all
    throw err // transient/other npm failure — fail visibly, don't mislabel
  }
}

/**
 * Package set from the top-level `on-*` directories (spec §3.2 rule 2), never
 * (do not write that glob with a trailing slash inside a block comment — the
 * `*` followed by `/` closes the comment and the file stops parsing), never
 * a hand-maintained table and never `packages/` — this repo is FLAT. A table
 * goes stale silently the next time a package lands; `on-shamir` would have
 * been missing from its own release.
 */
export function packageDirs(root = ROOT) {
  return readdirSync(root)
    .filter(name => name.startsWith('on-'))
    .filter(d => existsSync(join(root, d, 'package.json')))
    .sort()
}

export function buildPayload({ root = ROOT, tag, channel, runUrl, isFirstPublish = npmIsFirstPublish } = {}) {
  const dirs = packageDirs(root)
  if (dirs.length === 0) throw new Error('no on-* package directories found — refusing to emit an empty payload')

  const pkgs = dirs.map(dir => ({ dir, pj: JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')) }))

  // Lockstep ASSERTED, not assumed (spec §3.5 rule 3). One `version` per
  // payload is a schema requirement, so a skewed repo must fail here rather
  // than pick one version and describe the others wrongly.
  const versions = [...new Set(pkgs.map(p => p.pj.version))]
  if (versions.length !== 1) {
    throw new Error(
      `refusing to emit: packages are not on one version — ${versions.join(', ')}. ` +
      `The payload carries a single top-level version; emitting one of these would misdescribe the rest.`
    )
  }
  const version = versions[0]

  const rootChangelog = existsSync(join(root, 'CHANGELOG.md'))
    ? extractSection(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version)
    : null

  const packages = pkgs.map(({ dir, pj }) => {
    // Per-package CHANGELOG.md does not exist in this repo (all ten measured
    // absent). Read it anyway rather than hard-coding null: if this repo ever
    // adopts per-package changelogs, the rule starts working without an edit.
    const clPath = join(root, dir, 'CHANGELOG.md')
    const changelog = existsSync(clPath) ? extractSection(readFileSync(clPath, 'utf8'), version) : null
    const changeType = isFirstPublish(pj.name) ? 'added' : changelog !== null ? 'updated' : 'version-only'
    return {
      name: pj.name,
      dir,
      version: pj.version,
      description: pj.description ?? null,
      hubPeerRange: pj.peerDependencies?.['@noy-db/hub'] ?? null,
      changeType,
      changelog,
    }
  })

  return {
    bridge: 1,
    repo: REPO,
    version,
    tag: tag ?? `v${version}`,
    channel: channel ?? null,
    runUrl: runUrl ?? null,
    changelog: rootChangelog,
    packages,
  }
}

/**
 * The pre-upload validation the other producers run, plus the two additions the
 * spec asks for (§3.5 rule 4). Kept HERE rather than as a shell one-liner in
 * the workflow so it is testable and so a reader sees what "valid" means.
 */
export function assertValid(payload) {
  const problems = []
  if (payload.bridge !== 1) problems.push(`bridge must be 1, got ${JSON.stringify(payload.bridge)}`)
  if (!Array.isArray(payload.packages) || payload.packages.length === 0)
    problems.push('packages must be a non-empty array — an empty one is schema-valid and silently describes a release with no packages')
  if (payload.repo !== REPO) problems.push(`repo must be "${REPO}", got ${JSON.stringify(payload.repo)}`)
  if (payload.tag !== `v${payload.version}`)
    problems.push(`tag must be "v${payload.version}", got ${JSON.stringify(payload.tag)} — a tag that disagrees with the version makes the manifest record something the tag does not say`)
  for (const p of payload.packages ?? []) {
    if (!['added', 'updated', 'version-only'].includes(p.changeType))
      problems.push(`${p.dir}: changeType "${p.changeType}" is not one of added|updated|version-only — a fourth value stops the whole run`)
  }
  if (problems.length) throw new Error(`docs-bridge payload is invalid:\n  - ${problems.join('\n  - ')}`)
  return payload
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const get = flag => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1] }
  const payload = buildPayload({ tag: get('--tag'), channel: get('--channel'), runUrl: get('--run-url') })
  assertValid(payload)
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}
