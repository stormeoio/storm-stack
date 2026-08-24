# Release runbook

This runbook describes the MVP release flow for Storm Stack packages.

## Prerequisites

- Node.js `>=20.19.0` for development (`nvm use` selects the pinned `20.20.2`)
- npm 10+
- A GitHub remote for `stormeoio/storm-stack`
- A Trusted Publisher on every public package for `stormeoio/storm-stack`, `publish.yml`, and the GitHub `npm` environment
- The live publish job pinned to Node.js `22.14.0` and npm `11.5.1`, with GitHub OIDC enabled through `id-token: write`

Check the external release prerequisites before tagging or publishing:

```bash
npm run release:doctor
```

This doctor intentionally stays outside `release:check`: a local build can be release-ready even when the GitHub remote or external Trusted Publisher connections have not been configured yet. It verifies the repository-side tokenless OIDC workflow without requiring local npm authentication.

## Local release gate

Run this before tagging or publishing:

```bash
npm ci
npm run release:doctor
npm run release:check
npm run publish:dry-run
```

`release:check` verifies:

- internal workspace versions are synchronized with the root version
- public plugin catalogs are synchronized with `registry.json`
- public package metadata targets the npm registry explicitly, and an AST scan ensures every external runtime import is declared as a runtime or peer dependency
- TypeScript source files stay under the 1000-line limit
- production dependencies pass `npm audit --omit=dev --audit-level=moderate`
- lint, typecheck, build, and Vitest pass
- built CommonJS and ESM package exports report the exact version declared by their manifests
- `@stormeoio/create-storm-app` can generate and build an app outside the monorepo
- every public package can be packed

`publish:dry-run` runs the full release gate, then dry-runs npm publish for all public packages in dependency order.

## Version bump

For a local version bump:

```bash
npm run version:all
```

This bumps the root and workspace package versions, then syncs internal `@stormeoio/*`
dependency ranges and the versions of every `available` plugin in `registry.json`.

## Immutable proof tarballs

Build a complete release train from an immutable Git ref with:

```bash
npm run pack:tarballs -- \
  --ref proof/consent-v0.1.0-r3 \
  --destination /tmp/storm-stack-artifacts
```

The command requires a clean repository, checks out the requested commit in a
detached temporary worktree, builds every release package, rejects local dependency
specifiers, and writes a manifest containing the commit and SHA-256 of each tarball.
The destination must be outside the temporary worktree.

For the normal release path, dispatch the GitHub `Release` workflow from `main` with `bump` set to `patch`, `minor`, `major`, or `none`. The workflow rejects every other ref before dependency installation, applies the version change first, runs `release:check` on the exact tree that will be tagged, commits version changes when needed, and atomically pushes `main` with the single `vX.Y.Z` tag before creating the GitHub release. Because pushes made with the repository `GITHUB_TOKEN` do not trigger another workflow, the final release step explicitly sends a live `workflow_dispatch` to `publish.yml` at that immutable tag. Its job token grants only `contents: write` and `actions: write`; no PAT is required.

Only plain stable strict SemVer versions are currently releasable. Prerelease versions such as `1.0.0-beta.1` are rejected until the workflow supports an explicit npm dist-tag, and build-metadata versions such as `1.0.0+build.1` are rejected because npm ignores build metadata when comparing versions.

## Publish to npm

Publishing is handled by `.github/workflows/publish.yml`.

- Tag push `v*`: publishes live automatically.
- Manual dispatch with `dry_run=true`: can run from any Git ref and dry-runs publishing. The optional `version` input is only an assertion that must match the checked-out root `package.json`; it does not select another release.
- Manual dispatch with `dry_run=false`: publishes live only when the workflow is dispatched from the exact `v<package.json version>` tag, that tag points to the checked-out commit, and the commit is contained in `origin/main`. The optional `version` input has the same package-manifest assertion semantics. The Release workflow always uses this immutable-tag form.

The workflow calls:

```bash
node scripts/publish-all.mjs --live --provenance
```

Live mode is fail-closed and only runs from the exact version tag in the trusted `stormeoio/storm-stack` publish workflow. Before the first registry write, it requires GitHub OIDC, refuses `NPM_TOKEN` and every real `NODE_AUTH_TOKEN` value, permits only the fixed non-secret placeholder emitted by `actions/setup-node` for its registry configuration, requires a clean worktree, that tag at `HEAD`, and the tagged commit in `origin/main`. npm exchanges the GitHub identity for a short-lived publish credential only when `npm publish` runs; `npm whoami` is intentionally not used because it does not support Trusted Publisher authentication.

The script preflights every package version before publishing the first package. A version is skipped after a partial failure only when all of these checks pass:

- npm reports the same `gitHead`, repository URL, and repository directory as the release manifest
- `dist.attestations.url` is the HTTPS npm registry attestation endpoint and advertises SLSA v1 provenance
- the official, exactly pinned `sigstore@4.1.1` verifier validates the bundle signature, Fulcio chain from Sigstore TUF, certificate-transparency and Rekor inclusion, the GitHub OIDC issuer, and the exact `stormeoio/storm-stack/.github/workflows/publish.yml@refs/tags/v<version>` certificate identity
- the verified DSSE payload is an in-toto SLSA v1 statement with the exact npm package PURL and a SHA-512 subject digest equal to npm `dist.integrity`
- the SLSA GitHub Actions workflow fields identify `stormeoio/storm-stack`, `.github/workflows/publish.yml`, the exact release tag ref, the GitHub-hosted runner builder, a run invocation in the same repository, and a resolved Git dependency whose commit equals release `HEAD`

The preflight intentionally does not infer trust from the optional `internalParameters.github` numeric IDs and does not download and re-hash the tarball. Its package-content binding is the cryptographically verified attestation subject matched to npm's SHA-512 `dist.integrity`; npm remains the source of registry metadata and tarball integrity. Missing, ambiguous, malformed, unverifiable, or conflicting attestation data aborts the complete release train before the first publish.

The implementation follows the official [npm Trusted Publishers documentation](https://docs.npmjs.com/trusted-publishers/), [npm provenance and verification documentation](https://docs.npmjs.com/generating-provenance-statements/), the [SLSA provenance v1 schema](https://slsa.dev/provenance/v1), the [GitHub Actions workflow build type](https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1), and GitHub's documented [`GITHUB_TOKEN` workflow-dispatch exception](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow#triggering-a-workflow-from-a-workflow).

## Audit policy

The release gate blocks production dependency vulnerabilities with:

```bash
npm run audit:prod
```

As of the MVP release, a full `npm audit` still reports a dev-only advisory chain through `drizzle-kit -> @esbuild-kit/* -> esbuild@0.18.x`. Latest `drizzle-kit` still carries that transitive tooling dependency, and downgrading `drizzle-kit` is not an acceptable fix for the current Drizzle ORM version.

Do not downgrade `drizzle-kit` to satisfy the full dev audit. Revisit this when Drizzle Kit removes the affected `@esbuild-kit` dependency or publishes a safe upgrade path.

## Recovery checklist

If a release fails:

1. Fix the failing package or workflow configuration.
2. Re-run `npm run release:check`.
3. Re-run `npm run publish:dry-run`.
4. Ensure the exact `v<package.json version>` tag still points to the release commit in `main`.
5. Re-run the publish workflow from that exact tag. Only packages whose cryptographically verified npm provenance matches the same tagged workflow identity, release commit, subject digest, and manifest will be skipped.
