# Release

## Current policy

`dispatchkit` releases are PR-first and merge-triggered.

There is no manual version bump, no manual tag step, and no `semantic-release`.
When a PR lands on `main`, GitHub Actions decides the next version, stamps that
version into `package.json` and `package-lock.json` on the runner only,
publishes to npm with trusted publishing, pushes the matching `v*` tag, and
creates the GitHub release.

The repo keeps a development version in git. Published versions are derived in
CI from the latest release tag plus the merged PR's release level.

`main` is protected. Releases are expected to come from merged PRs, not local
machines and not direct pushes.

## Release levels

Release level comes from PR labels:

- `release:major`
- `release:minor`
- `release:patch`
- `release:none`

Default behavior:

- if no release label is present, the PR is released as a patch

Examples:

- latest tag `v0.1.14` + unlabeled merged PR -> `v0.1.15`
- latest tag `v0.1.14` + `release:minor` -> `v0.2.0`
- latest tag `v0.1.14` + `release:major` -> `v1.0.0`
- `release:none` -> skip publish, tag, and GitHub release

Conflicting release labels fail the workflow.

## Release flow

1. Open a PR with code changes only.
2. Run the normal validation checks:

   ```bash
   npm run check
   npm test
   npm run build
   ```

3. Optionally add one release label to the PR.
4. Merge the PR into `main`.
5. The `Release` workflow:

   - resolves the merged PR for the pushed commit
   - reads the release label, defaulting to patch
   - computes the next version from the latest `v*` tag
   - updates package files in the workflow workspace only
   - reruns `npm run check`, `npm test`, and `npm run build`
   - publishes with npm trusted publishing
   - pushes the new `v*` tag
   - creates the GitHub release

Do not manually publish, tag, or bump package versions in a PR.

## npm auth

Publishing is handled by npm trusted publishing with GitHub OIDC.

- keep `id-token: write` in the release workflow
- do not set `NPM_TOKEN`
- do not publish from local machines for normal releases

## Package identity

- npm package: `dispatchkit`
- installed binary: `dispatch`

This is intentional because the `dispatch` package name is already taken on npm.
