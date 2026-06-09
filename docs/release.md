# Release

This repo publishes the npm package `@sjunepark/ytm`. The npm package includes the Node-based `ytm` CLI through `package.json` `bin` and the reusable `./toolset` export.

Release Please owns normal version bumps, `CHANGELOG.md`, source tags, and GitHub Releases. The Release workflow validates tagged source and publishes npm. This repo does not build or upload standalone OS-native binaries.

## Manual setup

Configure npm trusted publishing for `@sjunepark/ytm`:

- Publisher: GitHub Actions
- Organization or user: `sjunepark`
- Repository: `ytm`
- Workflow filename: `release.yml`

The scoped npm package is created by the first successful publish. Because npm trusted publishing is configured from an existing package's npm settings, bootstrap the first version manually, then use the GitHub Actions trusted publisher for later releases.

Use `npm publish --access public` semantics; the package already declares `publishConfig.access` as `public`.

Configure this secret in this private repository:

- `RELEASE_PLEASE_TOKEN`: token used by `.github/workflows/release-please.yml` to open release PRs and create source tags/releases. Use a fine-grained PAT or GitHub App token, not the default `GITHUB_TOKEN`, so Release Please-created tags trigger `.github/workflows/release.yml`. Grant this repository Contents read/write and Pull requests read/write access.

Future npm publishing uses OIDC trusted publishing, so no long-lived npm publish token is required after the bootstrap publish.

Protect `main` so release PRs cannot merge until `.github/workflows/ci.yml` passes. At minimum, require the `CI / validate` status check before merging. Release Please and CI both run from pushes to `main`, so branch protection is the gate that ensures release PR contents are validated before Release Please creates source tags and releases.

This repository currently starts Release Please at version `0.1.0`. If you want the first npm publish to be exactly `0.1.0`, do this only after merging the release setup and confirming that exact version:

```sh
bun run test
npm publish --access public

git tag v0.1.0
git push origin v0.1.0
```

Then open `@sjunepark/ytm` on npmjs.com and add the trusted publisher listed above. The tag push may trigger `.github/workflows/release.yml`; it is idempotent and skips npm publish when `@sjunepark/ytm@0.1.0` already exists.

After that bootstrap, use Release Please for normal releases. If you skip the bootstrap publish/tag, the first Release Please PR will publish the next version it calculates from Conventional Commits after `0.1.0`, but npm trusted publishing still cannot work until the package exists on npm.

## Automated release flow

While the package is pre-1.0, Release Please treats normal `feat:` and `fix:` commits as patch releases and reserves minor bumps for breaking changes. This keeps rapid greenfield feature work on `0.1.x` unless a commit uses `!` or a `BREAKING CHANGE:` footer.

1. Land normal work on `main` using Conventional Commits, especially `feat:`, `fix:`, and `docs:`. Use `!` or a `BREAKING CHANGE:` footer for breaking changes.
2. `.github/workflows/ci.yml` validates pull requests with a build, tool-surface validation, and npm pack dry-run.
3. `.github/workflows/release-please.yml` opens or updates a release PR that bumps `package.json`, updates `.release-please-manifest.json`, and writes `CHANGELOG.md`.
4. Merge the release PR after CI passes.
5. Release Please creates the source tag and GitHub Release.
6. The source tag triggers `.github/workflows/release.yml`, which validates the package again and publishes npm.

The source tag must match `package.json` exactly. Version `x.y.z` uses source tag `vx.y.z`.

## Manual fallback

If automation needs to be bypassed, update `package.json` and `.release-please-manifest.json` to the same version, commit the change, and push a matching source tag:

```sh
git tag vx.y.z
git push origin main --tags
```

To republish an existing source tag without moving it, run the `Release` workflow manually with the `tag` input set to the existing tag, for example `v0.1.0`.

The workflow is idempotent. If the npm package version already exists, npm publish is skipped.
