#!/usr/bin/env node
//
// check-declared-deps — every package declares what it actually uses.
//
// WHY THIS EXISTS, and why the obvious alternative does not work.
//
// These packages were extracted from the noy-db monorepo, where nine of them
// used `happy-dom` as their vitest environment and NONE declared it. It
// resolved only because other workspace members — packages that stayed behind —
// declared it, at three different majors. The suites had been running for
// months against whichever version won hoisting.
//
// ⚠️ Declaring it did NOT fix that. MEASURED, 2026-09-01: with one package's
// declaration deleted, the full suite still PASSES — the very test that needs a
// happy-dom environment runs green — because a SIBLING declaring it is enough
// for pnpm's store to satisfy it. The hoisting prop did not go away when the
// packages left the monorepo; it moved into this repo.
//
// So there is no runtime signal to rely on, in either repo, ever. A green suite
// cannot tell you a package declares what it uses. Only a static check can, and
// that is this file.
//
//   node scripts/check-declared-deps.mjs
//
// Exit 1 on any package that uses something it does not declare.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Provided by the workspace root by convention, not per package. This is the
// one exemption, and it is deliberately tiny: a rule that over-fires teaches
// people to declare dependencies they do not have, which is its own defect.
const ROOT_TOOLING = new Set(['vitest', 'tsup', 'typescript', 'eslint'])

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const pkgDirs = readdirSync(ROOT).filter(
  (d) => !d.startsWith('.') && d !== 'node_modules' && d !== 'scripts' && existsSync(join(ROOT, d, 'package.json')),
)

const IMPORT = /^\s*(?:import|export)\b[^;\n]*?from\s+['"]([^'"]+)['"]/gm
const BARE_IMPORT = /^\s*import\s+['"]([^'"]+)['"]/gm
const DYNAMIC = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
const REQUIRE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g
// vitest takes its environment from a config field OR a docblock pragma. The
// pragma is syntactically a comment, so an import scan cannot see it — and that
// is the exact form `hub` used, which is how this class stayed hidden.
const ENV_FIELD = /environment:\s*['"]([a-z-]+)['"]/g
const ENV_PRAGMA = /@vitest-environment\s+([a-z-]+)/g

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(m?ts|m?js)$/.test(e.name)) out.push(p)
  }
  return out
}

/** `@scope/name/sub` → `@scope/name`; `name/sub` → `name`. */
const bare = (s) => (s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0])

const problems = []
let checked = 0

for (const d of pkgDirs) {
  const pj = readJson(join(ROOT, d, 'package.json'))
  const declared = new Set(
    ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap((f) =>
      Object.keys(pj[f] ?? {}),
    ),
  )
  const used = new Map() // specifier -> first file that used it

  const sourceFiles = [...walk(join(ROOT, d, 'src')), ...walk(join(ROOT, d, '__tests__'))]
  for (const file of sourceFiles) {
    const code = readFileSync(file, 'utf8')
    for (const re of [IMPORT, BARE_IMPORT, DYNAMIC, REQUIRE]) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(code)) !== null) {
        const spec = m[1]
        if (spec.startsWith('.') || spec.startsWith('node:')) continue
        const name = bare(spec)
        if (name === pj.name) continue // a package may reference itself
        if (!used.has(name)) used.set(name, file)
      }
    }
  }

  // Test environments: from any config file at the package root, and from
  // docblock pragmas inside the test files themselves.
  const envFiles = [
    ...readdirSync(join(ROOT, d)).filter((n) => n.endsWith('.config.ts') || n.endsWith('.config.mts')).map((n) => join(ROOT, d, n)),
    ...sourceFiles,
  ]
  for (const file of envFiles) {
    const code = readFileSync(file, 'utf8')
    for (const re of [ENV_FIELD, ENV_PRAGMA]) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(code)) !== null) if (m[1] !== 'node' && !used.has(m[1])) used.set(m[1], file)
    }
  }

  checked++
  for (const [name, file] of used)
    if (!declared.has(name) && !ROOT_TOOLING.has(name))
      problems.push(`${pj.name}: uses "${name}" but does not declare it  (${file.slice(ROOT.length + 1)})`)
}

if (problems.length) {
  console.error(`\n✗ ${problems.length} undeclared dependenc(ies) across ${checked} package(s):\n`)
  for (const p of problems) console.error(`   ${p}`)
  console.error(
    '\nA sibling declaring it is enough to make the tests pass, so the suite will NOT catch this.\n' +
      'Add it to that package\'s own dependencies/devDependencies.\n',
  )
  process.exit(1)
}

console.log(`✓ all ${checked} package(s) declare what they use (root tooling exempt: ${[...ROOT_TOOLING].join(', ')})`)
