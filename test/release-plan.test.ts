import { describe, expect, it } from 'vitest';
import { buildReleasePlan, normalizeTagVersion, resolveBaseVersion, resolveReleaseLevel } from '../scripts/release-plan.ts';

describe('release-plan', () => {
  it('defaults to a patch release when no release label is present', () => {
    const plan = buildReleasePlan({
      headTag: null,
      lastTag: 'v0.1.14',
      labels: [],
      prNumber: 42,
      prTitle: 'docs: rewrite release docs',
    });

    expect(plan).toEqual(
      expect.objectContaining({
        shouldRelease: true,
        releaseLevel: 'patch',
        version: '0.1.15',
        tag: 'v0.1.15',
      }),
    );
  });

  it('supports release:none to skip publishing', () => {
    const plan = buildReleasePlan({
      headTag: null,
      lastTag: 'v0.1.14',
      labels: ['release:none'],
    });

    expect(plan.shouldRelease).toBe(false);
    expect(plan.releaseLevel).toBe('none');
    expect(plan.reason).toContain('skipped');
  });

  it('supports minor and major release labels', () => {
    expect(
      buildReleasePlan({
        headTag: null,
        lastTag: 'v0.1.14',
        labels: ['release:minor'],
      }).version,
    ).toBe('0.2.0');

    expect(
      buildReleasePlan({
        headTag: null,
        lastTag: 'v0.1.14',
        labels: ['release:major'],
      }).version,
    ).toBe('1.0.0');
  });

  it('skips when the current commit is already tagged', () => {
    const plan = buildReleasePlan({
      headTag: 'v0.1.15',
      lastTag: 'v0.1.15',
      labels: [],
    });

    expect(plan.shouldRelease).toBe(false);
    expect(plan.reason).toContain('already tagged');
  });

  it('rejects conflicting release labels', () => {
    expect(() => resolveReleaseLevel(['release:minor', 'release:major'])).toThrow(/Conflicting release labels/);
  });

  it('normalizes missing tags to 0.0.0', () => {
    expect(normalizeTagVersion(null)).toBe('0.0.0');
  });

  it('prefers npm as the canonical published version', () => {
    expect(resolveBaseVersion({ publishedVersion: '0.1.14', highestTag: 'v0.1.13' })).toBe('0.1.14');
  });

  it('falls back to the highest tag when the package is not published yet', () => {
    expect(resolveBaseVersion({ publishedVersion: null, highestTag: 'v0.1.13' })).toBe('0.1.13');
  });
});
