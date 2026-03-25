import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';
import semver from 'semver';

export type ReleaseLevel = 'none' | 'patch' | 'minor' | 'major';

export interface ReleasePlan {
  shouldRelease: boolean;
  reason: string;
  releaseLevel: ReleaseLevel;
  version?: string;
  tag?: string;
  lastTag?: string;
  prNumber?: number;
  prTitle?: string;
  labels?: string[];
}

interface PullRequestLabel {
  name?: string;
}

interface PullRequestRef {
  number: number;
  title: string;
  merge_commit_sha?: string | null;
  merged_at?: string | null;
  labels?: PullRequestLabel[];
}

const RELEASE_LABELS: Record<string, ReleaseLevel> = {
  'release:none': 'none',
  'release:patch': 'patch',
  'release:minor': 'minor',
  'release:major': 'major',
};
const PACKAGE_NAME = 'dispatchkit';

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function gitOrNull(args: string[]): string | null {
  try {
    const value = git(args);
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function headReleaseTag(): string | null {
  return gitOrNull(['tag', '--points-at', 'HEAD', '--list', 'v*']);
}

export function highestReleaseTag(): string | null {
  const output = gitOrNull(['tag', '--list', 'v*', '--sort=-version:refname']);
  return output?.split('\n')[0] ?? null;
}

export function normalizeTagVersion(tag: string | null): string {
  if (!tag) return '0.0.0';
  const version = semver.valid(tag.startsWith('v') ? tag.slice(1) : tag);
  if (!version) {
    throw new Error(`Invalid release tag: ${tag}`);
  }
  return version;
}

export function resolveBaseVersion(input: {
  publishedVersion: string | null;
  highestTag: string | null;
}): string {
  if (input.publishedVersion) {
    return normalizeTagVersion(input.publishedVersion);
  }

  return normalizeTagVersion(input.highestTag);
}

export function resolveReleaseLevel(labels: string[]): ReleaseLevel {
  const matches = labels
    .map((label) => RELEASE_LABELS[label])
    .filter((value): value is ReleaseLevel => value !== undefined);

  const unique = [...new Set(matches)];
  if (unique.length > 1) {
    throw new Error(`Conflicting release labels: ${unique.join(', ')}`);
  }

  if (unique.length === 1) {
    return unique[0];
  }

  return 'patch';
}

export function buildReleasePlan(input: {
  headTag: string | null;
  lastTag: string | null;
  labels: string[];
  prNumber?: number;
  prTitle?: string;
}): ReleasePlan {
  if (input.headTag) {
    return {
      shouldRelease: false,
      reason: `commit already tagged with ${input.headTag}`,
      releaseLevel: 'none',
      lastTag: input.headTag,
      prNumber: input.prNumber,
      prTitle: input.prTitle,
      labels: input.labels,
    };
  }

  const releaseLevel = resolveReleaseLevel(input.labels);
  if (releaseLevel === 'none') {
    return {
      shouldRelease: false,
      reason: 'release skipped by label',
      releaseLevel,
      lastTag: input.lastTag ?? undefined,
      prNumber: input.prNumber,
      prTitle: input.prTitle,
      labels: input.labels,
    };
  }

  const lastVersion = normalizeTagVersion(input.lastTag);
  const version = semver.inc(lastVersion, releaseLevel);
  if (!version) {
    throw new Error(`Unable to bump ${lastVersion} with level ${releaseLevel}`);
  }

  return {
    shouldRelease: true,
    reason: 'release planned',
    releaseLevel,
    version,
    tag: `v${version}`,
    lastTag: input.lastTag ?? undefined,
    prNumber: input.prNumber,
    prTitle: input.prTitle,
    labels: input.labels,
  };
}

async function fetchMergedPullRequest(repo: string, sha: string, token: string): Promise<PullRequestRef> {
  const response = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/pulls`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'dispatch-release-plan',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}) while resolving PR for ${sha}`);
  }

  const pulls = (await response.json()) as PullRequestRef[];
  const merged = pulls.find((pull) => pull.merge_commit_sha === sha) ?? pulls.find((pull) => Boolean(pull.merged_at));
  if (!merged) {
    throw new Error(`No merged pull request found for commit ${sha}`);
  }

  return merged;
}

function latestPublishedVersion(packageName: string): string | null {
  try {
    const raw = execFileSync('npm', ['view', packageName, 'version', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!raw) return null;

    const parsed = JSON.parse(raw) as string;
    return semver.valid(parsed) ?? null;
  } catch {
    return null;
  }
}

function writeOutputs(plan: ReleasePlan): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;

  const lines = [
    `should_release=${plan.shouldRelease ? 'true' : 'false'}`,
    `reason=${plan.reason}`,
    `release_level=${plan.releaseLevel}`,
  ];

  if (plan.version) lines.push(`version=${plan.version}`);
  if (plan.tag) lines.push(`tag=${plan.tag}`);
  if (plan.lastTag) lines.push(`last_tag=${plan.lastTag}`);
  if (plan.prNumber !== undefined) lines.push(`pr_number=${plan.prNumber}`);
  if (plan.prTitle) lines.push(`pr_title=${plan.prTitle}`);

  fs.appendFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
}

async function main(): Promise<void> {
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  const token = process.env.GITHUB_TOKEN;

  if (!repo || !sha || !token) {
    throw new Error('GITHUB_REPOSITORY, GITHUB_SHA, and GITHUB_TOKEN are required');
  }

  const pr = await fetchMergedPullRequest(repo, sha, token);
  const labels = (pr.labels ?? []).map((label) => label.name).filter((value): value is string => Boolean(value));
  const publishedVersion = latestPublishedVersion(PACKAGE_NAME);
  const highestTag = highestReleaseTag();
  const plan = buildReleasePlan({
    headTag: headReleaseTag(),
    lastTag: `v${resolveBaseVersion({ publishedVersion, highestTag })}`,
    labels,
    prNumber: pr.number,
    prTitle: pr.title,
  });

  writeOutputs(plan);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

const scriptPath = process.argv[1];
if (scriptPath && import.meta.url === new URL(`file://${scriptPath}`).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
