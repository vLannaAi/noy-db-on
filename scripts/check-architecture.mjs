import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// ARCH_ROOT lets the self-test point the scan at a fixtures dir; default is
// the repo root (one level up from scripts/).
const ROOT = process.env.ARCH_ROOT
  ? resolve(process.env.ARCH_ROOT)
  : resolve(fileURLToPath(import.meta.url), '../..')

let failures = 0
function fail(rule, msg, where) {
  failures++
  console.error(`✗ [${rule}] ${msg}${where ? ` (${relative(ROOT, where)})` : ''}`)
}

// Stores are flat at the repo root: directories named `on-*` with a package.json.
function listStoreDirs() {
  if (!existsSync(ROOT)) return []
  return readdirSync(ROOT)
    .filter(name => name.startsWith('on-'))
    .map(name => join(ROOT, name))
    .filter(p => statSync(p).isDirectory())
    .filter(p => existsSync(join(p, 'package.json')))
}

function readPkg(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
}

function walkTs(dir, cb) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walkTs(p, cb)
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) cb(p, readFileSync(p, 'utf8'))
  }
}

// Rule 1 — hub-peer-range: @noy-db/hub must be a peerDependency at a published
// RANGE; never in dependencies, never a workspace: specifier.
// Does this package actually reference hub in its shipped source? Three `on-*`
// members are standalone primitives (on-email-otp, on-threat, on-totp) that
// import hub NOWHERE — they are pure algorithms wearing the family prefix. The
// ported rule demanded a hub peer from every package, which is the right
// invariant for noy-db-to (every store binds /to) and simply false here.
//
// The invariant this was always approximating: IF you import hub, you must
// declare it as a ranged peer. A package that does not import it owes nothing,
// and forcing a peer it never uses would declare a dependency that is not real.
function importsHub(dir) {
  let found = false
  walkTs(join(dir, 'src'), (_file, code) => {
    HUB_IMPORT_RE.lastIndex = 0
    if (HUB_IMPORT_RE.test(code)) found = true
  })
  return found
}

function checkHubPeerRange() {
  for (const dir of listStoreDirs()) {
    const pj = readPkg(dir)
    const dep = pj.dependencies?.['@noy-db/hub']
    const peer = pj.peerDependencies?.['@noy-db/hub']
    if (dep !== undefined)
      fail('hub-peer-range', `${pj.name} has @noy-db/hub in dependencies; it must be a peerDependency range.`, dir)
    if (peer === undefined && !importsHub(dir)) continue // standalone primitive — owes no peer
    if (peer === undefined)
      fail('hub-peer-range', `${pj.name} imports @noy-db/hub but declares no peerDependencies['@noy-db/hub'].`, dir)
    else if (peer.startsWith('workspace:'))
      fail('hub-peer-range', `${pj.name} peers @noy-db/hub as "${peer}"; a cross-repo package must use a published range (e.g. "^0.7.0").`, dir)
    else if (!/^[\^~]?\d/.test(peer))
      fail('hub-peer-range', `${pj.name} peers @noy-db/hub as "${peer}"; expected a semver range.`, dir)
  }
}

// Rule 2 — no-runtime-store-import: on-* src may not VALUE-import @noy-db/hub/to.
// ⚠️ This header read "to-only: store src may import @noy-db/hub ONLY via /to" —
// noy-db-to's rule, and FALSE HERE: it asserted exactly what the note inside the
// function exists to deny. Kept and marked false rather than deleted, because the
// MECHANISM transferred from noy-db-to and only the ownership did not.
// Covers static imports (from/import), dynamic import(), require(), and bare
// side-effect imports (import '@noy-db/hub').
const HUB_IMPORT_RE = /(?:from|import|require)\s*\(?\s*['"]@noy-db\/hub(\/[^'"]*)?['"]/g
function checkNoRuntimeStoreImport() {
  // Rule 2 — no-runtime-store-import (the `on-*` layer boundary).
  //
  // NOT noy-db-to's `to-only` rule, which requires a package to import ONLY
  // `@noy-db/hub/to`. Ported verbatim it fails on correct code here, because a
  // `on-*` package binds its own port and legitimately reads shared types
  // from the root.
  //
  // What IS invariant: an unlock primitive proves who you are and yields key
  // material — it never touches the store. So a VALUE import of the store
  // contract is a layer violation, while a TYPE-only import is not — the types
  // erase at build and move no data.
  //
  // ⚠️ Implemented by scanning BACKWARD from each module specifier to its own
  // `import` keyword, NOT by one regex over the statement. A pattern like
  // /import\s+(type\s+)?[^;]*?from '...'/ looks right and is wrong: `[^;]`
  // matches NEWLINES, so it happily spans from an unrelated multi-line
  // `import { a, b, c }` at the top of a file down to a `from` clause far
  // below, reports the wrong statement, and misses the `type` keyword that is
  // actually there. That produced a false positive on real code.
  const SPEC = "from '@noy-db/hub/to'"
  for (const dir of listStoreDirs()) {
    const pj = readPkg(dir)
    walkTs(join(dir, 'src'), (file, code) => {
      let at = code.indexOf(SPEC)
      while (at !== -1) {
        const kw = code.lastIndexOf('import', at)
        // The statement is type-only if `type` is the next token after `import`.
        const isTypeOnly = kw !== -1 && /^import\s+type\b/.test(code.slice(kw, at))
        if (!isTypeOnly)
          fail('no-runtime-store-import',
            `${pj.name}: value-imports '@noy-db/hub/to' — an unlock primitive proves who you are ` +
            `and yields key material; it never touches the store. ` +
            `Use \`import type\` if you only need the contract's types.`, file)
        at = code.indexOf(SPEC, at + 1)
      }
    })
  }
}

// Rule 3 — no-crypto-deps: zero npm crypto packages.
// ⚠️ The ported reason was "stores see ciphertext only". FALSE HERE, and kept marked
// false because the mechanism is right and only the justification travelled wrong: an
// on-* package is not a store and legitimately handles KEY MATERIAL. It may not take a
// crypto dependency because @noy-db/hub OWNS the primitives — one audited implementation,
// not one per unlock method. The true sentence differs per repo (as-* sees plaintext by
// design; at-* is the non-zero-knowledge family), so this is not a family-wide edit —
// lanna-db#13.
const BANNED = new Set(['crypto-js', 'node-forge', 'tweetnacl', 'bcryptjs', 'bcrypt'])
function checkNoCryptoDeps() {
  for (const dir of listStoreDirs()) {
    const pj = readPkg(dir)
    for (const block of ['dependencies', 'devDependencies', 'peerDependencies']) {
      for (const name of Object.keys(pj[block] ?? {})) {
        if (BANNED.has(name) || name.startsWith('@noble/') || name.startsWith('@scure/'))
          fail('no-crypto-deps', `${pj.name} depends on crypto package "${name}"; @noy-db/hub owns the crypto primitives — import them from hub.`, dir)
      }
    }
  }
}

checkHubPeerRange()
checkNoRuntimeStoreImport()
checkNoCryptoDeps()

if (failures > 0) {
  console.error(`\n✗ Architecture invariants FAILED (${failures})`)
  process.exit(1)
}
console.log('✓ Architecture invariants OK')
