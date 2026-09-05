import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // ⚠️ PACKAGES ONLY. A test written anywhere else — `scripts/__tests__`, a
    // root `__tests__` — matches no project and vitest reports a clean green
    // run WITHOUT IT. Not a hypothetical: noy-db-as found exactly this shape in
    // its own config, and it is the failure mode of the thing it would be
    // testing (a check that cannot fail is not evidence).
    //
    // There are no `scripts/` tests today, so nothing is silently skipped right
    // now. `scripts/docs-bridge/build-payload.mjs` is guarded instead by a CI
    // step that RUNS it (ci.yml, "Docs bridge payload builds and validates"),
    // which is stronger than a unit test for the two ways it actually breaks:
    // failing to parse, and emitting an invalid payload.
    //
    // If you add a test under `scripts/`, add a project for it HERE in the same
    // commit and watch it fail once before trusting it green.
    projects: [
      'on-*/vitest.config.ts',
    ],
  },
})
