# `@noy-db/on-*` — unlock and auth primitives for noy-db

The **`on-` family**: *get **on** via this method*. Each package is one way to prove who you are and
yield key material, bound to the published `@noy-db/hub/on` port. **None of them ever sees
plaintext** — an unlock primitive produces keys; the hub does the decrypting.

Extracted from the `noy-db` monorepo so hub can iterate without republishing this family.

| package | method |
|---|---|
| `on-password` · `on-pin` | secret-based unlock |
| `on-webauthn` | platform authenticators / passkeys |
| `on-totp` · `on-email-otp` | second factors |
| `on-magic-link` | link-based grant issuance |
| `on-oidc` | federated identity |
| `on-recovery` · `on-threat` | recovery flows and threat signals |

**`@noy-db/on-shamir` is deliberately NOT here** — it stays in the core `noy-db` repo. Hub's own
recovery suite imports it in seven test files to exercise real k-of-n threshold behaviour, and
moving it would put hub's inner loop behind this repo's publish cadence.

## Two shapes in one family

Six of these bind hub (`@noy-db/hub` as a caret-ranged **peer**). Three — `on-email-otp`,
`on-threat`, `on-totp` — import hub **nowhere**: they are standalone algorithms that happen to carry
the prefix. `check:architecture` knows the difference and demands a hub peer only from packages that
actually import hub.

```bash
npm i @noy-db/hub @noy-db/on-password    # a hub-bound member
npm i @noy-db/on-totp                    # standalone; needs no hub
```

## Develop

```bash
pnpm install && pnpm build && pnpm test && pnpm lint && pnpm typecheck
pnpm check:architecture   # layer invariants
pnpm check:peer-floor     # every hub-bound package must COMPILE at the oldest hub its range admits
```

## Coverage, stated honestly

Only `on-password` and `on-webauthn` run the published `@noy-db/test-ceremony-conformance` kit. The
other seven are verified by their own suites against the published hub — which is real coverage, but
it is not *external-author* coverage, and a green suite here should not be read as a kit run.

Publishing happens from a **GitHub Release** triggering `release.yml`, never a raw `npm publish`.
Pre-1.0: public APIs may still change.
