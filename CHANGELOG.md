# Changelog

All ten `@noy-db/on-*` packages share one version line and are released together.

This file is **hand-written**. There is no changeset tooling here, deliberately: this repo has
zero internal dependency edges, so there is no dependency closure to compute, and changesets'
pre-mode/`pre.json`/normalization machinery would be ceremony at full price for a problem this
repo does not have. See `scripts/version-set.mjs` for the mechanism that replaced it.

⚠️ **This changelog does not ship.** Every package's `files` array is
`["dist", "README.md", "LICENSE"]`, verified — so unlike `@noy-db/hub`, whose changelog *is* in
its tarball and therefore immutable once published, a mistake here can simply be corrected in
place. Do not apply hub's correct-alongside-in-the-next-entry constraint to this file.

## 0.7.1-pre.0

⭐ **This section is not housekeeping — it is the release payload's only prose.** Under the
doc-sync source contract this repo emits a top-level `changelog` read from the `## <version>`
section here, because it has no per-package `CHANGELOG.md` and a release-scoped narrative cannot
be split across ten packages truthfully. An unwritten section means a payload with no prose at
all, so this is written *before* the cut, never with it.

### Added

- **`@noy-db/on-shamir` moves here from `noy-db`** (ruling lanna-db#10). `shamirRecoveryProvider()`,
  `splitKEK`, `combineKEK` and the `on-*` framing land in this repo; the GF(2^8) math and the share
  codecs became `@noy-db/shamir`, a zero-dependency primitive with no hub contract, published from
  core. This package takes a plain caret dependency on it and re-exports its whole surface, so
  `on-shamir@0.7.0`'s published surface is unchanged — code naming `splitSecret` or
  `encodeShareBase32` keeps compiling.
  - ⭐ **The structural mirror of hub's `NoydbShamir` is deleted, not copied.** It existed because
    hub devDepended on this package for six recovery tests, making a peer edge a turbo build cycle.
    Hub's tests now build a four-line adapter over `@noy-db/shamir` and import this package nowhere,
    so the cycle is gone. `NoydbShamir` is imported as a type from `@noy-db/hub/on`; hub is its sole
    declaration.
  - ⚠️ Its npm name is **not new** — core published it from `0.1.0-pre.3` through `0.7.0`. Only the
    publisher changed, which is why the release payload reports it as `version-only` rather than
    `added`.

### Changed

- The six hub-binding packages, and now `on-shamir`, widen their `@noy-db/hub` peer from `^0.7.0`
  to `^0.7.0 || ^0.7.1-pre.0` — appended, never replaced. `^0.7.0` admits no prerelease of any
  version, so without this the seven cannot resolve against the `0.7.1` pre line at all.

### Fixed

- **CI never ran on stacked PRs** (lanna-db#12). `pull_request: branches: [main]` filters the *base*
  branch, so a PR stacked on another branch matched nothing and no workflow ran — GitHub then
  reports "no checks reported", which renders as pending rather than as an error.
- **Three ported-text defects in `check-architecture.mjs`** (lanna-db#13), all inherited from the
  noy-db-to port and all invisible to a green run, because a gate's failure message is code that
  executes only on failure. The `no-runtime-store-import` message printed a literal `\n  // ` into
  its own text; the `Rule 2` header asserted the `to-only` rule that the note beneath it exists to
  deny; and `no-crypto-deps` explained itself with the wrong threat model ("stores see ciphertext
  only" — an `on-*` package is not a store and legitimately handles key material; it may not take a
  crypto dependency because `@noy-db/hub` owns the primitives). Both wrong reasons are kept and
  marked false rather than deleted.
- Both workflow headers called these packages "storage adapters", inverting the family's prefix
  grammar in the two files a newcomer opens first.

## Unreleased

### Added

- `pnpm version:set <version>` — puts every package on one version in a single act. It does not
  order or compare versions; ordering is npm's job, asked via `check:not-already-published`.
- `pnpm check:versions-uniform` — the guard against a **partial bump**. Asserts one version across
  all nine packages, uniform lockstep `@noy-db/*` ranges, every internal range admitting the common
  version, and every exact dev pin admitted by the peer range declared beside it. Takes
  `--expect <version>` for the release gate. All five assertions are mutation-checked.
- `pnpm check:not-already-published` — asks npm whether the version in the manifests already
  exists. **Fails closed**: exit 0 free, 1 already published, 2 could not determine. A registry
  timeout is never rendered as "the version is free".

### Fixed

- **The release version gate could never pass.** `release.yml` compared the release tag against
  `require('./package.json').version` from the *root* manifest — the lockstep canonical in
  noy-db-to, whose root carries a version. This root is `private` and versionless, so the
  expression yielded the string `"undefined"` and the comparison failed for every possible tag.
  Found before the workflow had ever run. It now asserts the property that matters: every package
  equals the tag.
- **`release.yml` named another repo's packages** in seven places — six `@noy-db/to-aws-s3` and one
  `@noy-db/to-x`, a verbatim paste from noy-db-to. Three were live `GITHUB_STEP_SUMMARY` writes, so
  a release run printed install instructions for a package in a different repo and pointed
  provenance verification at the wrong npm page.
- **An expired justification** on the pre-release routing guard, kept as a record rather than a
  reason. It claimed `@latest` was broken across "all 17 `on-*@0.5.0` versions". Measured: there
  are nine packages here, not 17 (17 is a `to-*` count); `@latest` is `0.7.0`, a stable, on all
  nine; the packument's `deprecated` field is null. The guard stays — it is right for the general
  reason, not the expired one.

## 0.7.0

**Published from `noy-db`, not from this repo.** noy-db cut `0.7.0` for all 57 packages on
2026-09-01 (`1ef894f6`) and removed the `on-*` family immediately afterwards (`22fecc8c`), so these
nine packages shipped at `0.7.0` from core and this repo — extracted at `0.7.0-pre.17` — never
recorded it. npm's registry entries still carry `repository.directory: packages/<pkg>` against
`vLannaAi/noy-db`. A clean handover, not a lost release.

**No code changed.** The published `dist/` is byte-identical across `0.7.0-pre.17`, `0.7.0-pre.18`
and `0.7.0` for all nine packages, and no `src/` file has changed in this repo since extraction.
Only the manifests were behind.

### Changed

- The six hub-binding packages (`on-magic-link`, `on-oidc`, `on-password`, `on-pin`, `on-recovery`,
  `on-webauthn`) narrow their `@noy-db/hub` peer from `^0.7.0-pre.17` to `^0.7.0`, matching what
  published `0.7.0` declares. A prerelease caret is the **wider** range — it reaches forward into
  its stable *and* admits the whole pre line — so keeping it would silently re-widen what `0.7.0`
  narrowed.
- ⚠️ **Do not mix stable and prerelease satellites.** Caret ranges are directional across the
  prerelease boundary: `^0.7.0-pre.18` admits `0.7.0`, but `^0.7.0` excludes `0.7.0-pre.18`. On the
  stable line, use stable satellites throughout.

### Unchanged, deliberately

- `on-email-otp`, `on-threat` and `on-totp` import `@noy-db/hub` nowhere and declare **no hub
  peer**. `check:architecture`'s `hub-peer-range` rule demands a peer only from packages that
  actually import hub, and `check:peer-floor` reports these three as skipped. Forcing a peer a
  package never uses would declare a dependency that is not real — do not let a version sweep
  "helpfully" add one.
