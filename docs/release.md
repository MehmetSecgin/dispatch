# Release

## Current policy

`dispatchkit` releases are PR-first, merge-triggered, and versioned by commit
history rather than manual `package.json` edits.

When code lands on `main`, GitHub Actions runs `semantic-release` from the
merged commit. It decides whether to release, computes the next version from
the commits since the previous tag, publishes the npm package, pushes the
matching `v*` tag, and creates the GitHub release.

`main` is protected. Release changes must land through a pull request and pass
the required `validate` check before the release workflow runs.

Release automation expects npm trusted publishing to be configured for this repo
so GitHub Actions can publish without a long-lived npm token.

Why:

- the project is still early
- release judgment still matters
- package contents and release cadence are still settling

## Stable release flow

1. Run the code validation checks on the intended release candidate:

   ```bash
   npm run check
   npm test
   npm run build
   ```

2. Open a pull request with the code changes only. Do not manually bump
   `package.json` or `package-lock.json` for releases.

3. Merge the pull request after the required checks pass.

4. The `Release` workflow runs on the merged branch commit and:

   - installs dependencies with `npm ci`
   - reruns `npm run check`, `npm test`, and `npm run build`
   - decides whether the merged commits justify a release
   - computes the next version from commit messages and tags
   - publishes the package to npm
   - pushes the matching `v<version>` tag
   - creates the GitHub release notes

Never publish or tag from an unmerged local-only commit. The published package,
the release tag, and the GitHub release should all come from the same merged
commit on the release branch.

### Commit types

Release automation follows conventional commit semantics:

- `feat:` -> minor release
- `fix:` -> patch release
- `update:` -> patch release
- `perf:` -> patch release
- `type!:` or `BREAKING CHANGE:` -> major release
- other commit types do not trigger a release by default

If you use squash merges, the final PR title becomes the release-driving commit
message, so it needs to use the intended conventional commit type.

Example:

```bash
# in the release PR
npm run check
npm test
npm run build

# use a conventional PR title / squash commit title like:
# feat: add direct action runs
# fix: handle missing credential env vars
```

## Package identity

- npm package: `dispatchkit`
- installed binary: `dispatch`

This is intentional because the `dispatch` package name is already taken on npm.

## Beta releases

Use semver prereleases and the npm `beta` dist-tag.

Examples:

- `0.1.0-beta.1`
- `0.1.0-beta.2`

Follow the same PR-first flow as stable releases. Versions with a prerelease
suffix like `0.1.0-beta.1` are published automatically from the `beta` branch
with the npm `beta` dist-tag by the release workflow.

Users who want beta builds can install:

```bash
npm install -g dispatchkit@beta
```

Stable users continue to get the `latest` tag.

Current automation:

- CI workflow on pull requests and `main`:
  - `npm run check`
  - `npm test`
  - `npm run build`
- release workflow on pushed `main` and `beta` commits:
  - rerun `npm run check`
  - rerun `npm test`
  - rerun `npm run build`
  - analyze commit messages since the previous tag
  - compute the next release version automatically
  - publish to npm from the merged commit
  - push the matching `v*` tag
  - create the GitHub release

Ordinary merges that do not contain release-worthy commit types complete
successfully and produce no new version.
