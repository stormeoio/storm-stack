# Release runbook

This runbook describes the MVP release flow for Storm Stack packages.

## Prerequisites

- Node.js `>=20.19.0` (`nvm use` selects the pinned `20.20.2`)
- npm 10+
- A GitHub remote for `stormeoio/storm-stack`
- An npm automation token available as `NPM_TOKEN` in the GitHub `npm` environment
- npm provenance enabled in GitHub Actions (`id-token: write`)

## Local release gate

Run this before tagging or publishing:

```bash
npm ci
npm run release:check
npm run publish:dry-run
```

`release:check` verifies:

- internal workspace versions are synchronized with the root version
- public plugin catalogs are synchronized with `registry.json`
- production dependencies pass `npm audit --omit=dev --audit-level=moderate`
- lint, typecheck, build, and Vitest pass
- `create-storm-app` can generate and build an app outside the monorepo
- every public package can be packed

`publish:dry-run` runs the full release gate, then dry-runs npm publish for all public packages in dependency order.

## Version bump

For a local version bump:

```bash
npm run version:all
```

This bumps the root and workspace package versions, then syncs internal `@stormstack/*` dependency ranges.

For the normal release path, use the GitHub `Release` workflow with `bump` set to `patch`, `minor`, `major`, or `none`. The workflow runs `release:check`, commits version changes when needed, tags `vX.Y.Z`, and creates the GitHub release.

## Publish to npm

Publishing is handled by `.github/workflows/publish.yml`.

- Tag push `v*`: publishes live automatically.
- Manual dispatch with `dry_run=true`: validates the requested version and dry-runs publishing.
- Manual dispatch with `dry_run=false`: publishes the requested version.

The workflow calls:

```bash
node scripts/publish-all.mjs --live --provenance
```

The script publishes packages in dependency order and skips packages that already exist on npm, so it can be rerun after a partial publish failure.

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
4. Re-run the publish workflow. Already published package versions will be skipped.
