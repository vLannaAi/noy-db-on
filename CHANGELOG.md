# Changelog

All nine `@noy-db/on-*` packages share one version line and are released together.

This file is **hand-written**. There is no changeset tooling here, deliberately: this repo has
zero internal dependency edges, so there is no dependency closure to compute, and changesets'
pre-mode/`pre.json`/normalization machinery would be ceremony at full price for a problem this
repo does not have. See `scripts/version-set.mjs` for the mechanism that replaced it.

⚠️ **This changelog does not ship.** Every package's `files` array is
`["dist", "README.md", "LICENSE"]`, verified — so unlike `@noy-db/hub`, whose changelog *is* in
its tarball and therefore immutable once published, a mistake here can simply be corrected in
place. Do not apply hub's correct-alongside-in-the-next-entry constraint to this file.

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
