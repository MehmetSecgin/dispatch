# Release

## Current policy

At this stage, `dispatchkit` releases are published manually.

We use GitHub Actions for verification later, but we do not auto-publish from CI yet.

Why:

- the project is still early
- release judgment still matters
- package contents and release cadence are still settling

## Stable release flow

1. Update `package.json` and `package-lock.json` to the target version.
2. Run:

   ```bash
   npm run check
   npm test
   npm run build
   npm publish --dry-run
   ```

3. Publish:

   ```bash
   npm publish
   ```

4. Tag and push:

   ```bash
   git tag v<version>
   git push origin main --tags
   ```

Example:

```bash
git tag v0.0.2
git push origin main --tags
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

Publish betas with:

```bash
npm publish --tag beta
```

Users who want beta builds can install:

```bash
npm install -g dispatchkit@beta
```

Stable users continue to get the `latest` tag.

## Future automation

When the release process is more settled, the preferred automation model is:

- CI workflow on pull requests and `main`:
  - `npm run check`
  - `npm test`
  - `npm run build`
  - `npm publish --dry-run`
- release workflow on pushed tags like `v0.1.0`
  - publish to npm

We should avoid publishing on every push to `main`.

