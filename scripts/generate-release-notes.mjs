#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const TYPE_HEADINGS = new Map([
  ['feat', 'Features'],
  ['fix', 'Fixes'],
  ['update', 'Updates'],
  ['docs', 'Documentation'],
  ['refactor', 'Maintenance'],
  ['perf', 'Maintenance'],
  ['test', 'Maintenance'],
  ['build', 'Maintenance'],
  ['ci', 'Maintenance'],
  ['chore', 'Maintenance'],
  ['style', 'Maintenance'],
  ['other', 'Maintenance'],
]);

const RELEASE_ONLY_FILES = new Set(['package.json', 'package-lock.json']);

function parseArgs(argv) {
  const args = { tag: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--tag') {
      args.tag = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }

  if (!args.tag) {
    throw new Error('missing required --tag <tag>');
  }

  return args;
}

function runGit(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function tryGit(args) {
  try {
    return runGit(args);
  } catch {
    return '';
  }
}

function normalizeGitHubRemote(remoteUrl) {
  if (!remoteUrl) {
    return '';
  }

  const sshMatch = remoteUrl.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}`;
  }

  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    return `https://github.com/${httpsMatch[1]}`;
  }

  return '';
}

function findPreviousTag(tag) {
  return tryGit(['describe', '--tags', '--abbrev=0', `${tag}^`]);
}

function classifyCommit(subject) {
  const match = subject.match(/^([a-z]+)(?:\([^)]+\))?!?:\s+(.+)$/i);
  if (!match) {
    return { heading: TYPE_HEADINGS.get('other'), text: subject };
  }

  const [, rawType, text] = match;
  const heading = TYPE_HEADINGS.get(rawType.toLowerCase()) ?? TYPE_HEADINGS.get('other');
  return { heading, text };
}

function formatCommitLine(commit, repoUrl) {
  const shortSha = commit.sha.slice(0, 7);
  if (!repoUrl) {
    return `- ${commit.text} (\`${shortSha}\`)`;
  }

  return `- ${commit.text} ([\`${shortSha}\`](${repoUrl}/commit/${commit.sha}))`;
}

function loadChangedFiles(sha) {
  const raw = tryGit(['diff-tree', '--no-commit-id', '--name-only', '-r', sha]);
  if (!raw) {
    return [];
  }

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function isReleaseCommit(subject) {
  return /^chore: release v/i.test(subject);
}

function isVersionOnlyReleaseCommit(files) {
  return files.length > 0 && files.every((file) => RELEASE_ONLY_FILES.has(file));
}

function summarizeAreas(files) {
  const labels = [];
  const add = (label) => {
    if (!labels.includes(label)) {
      labels.push(label);
    }
  };

  for (const file of files) {
    if (RELEASE_ONLY_FILES.has(file) || file.startsWith('test/')) {
      continue;
    }

    if (file === 'README.md' || file.startsWith('docs/')) {
      add('docs');
      continue;
    }

    if (file.startsWith('src/authoring/')) {
      add('authoring');
      continue;
    }

    if (file.startsWith('src/modules/builtin/memory/')) {
      add('memory module');
      continue;
    }

    if (file.startsWith('src/commands/module.ts') || file.startsWith('src/modules/artifact.ts')) {
      add('module tooling');
      continue;
    }

    if (file.startsWith('src/job/') || file === 'src/commands/job.ts') {
      add('job runtime');
      continue;
    }

    if (file.startsWith('src/execution/')) {
      add('execution');
      continue;
    }

    if (file.startsWith('src/transport/')) {
      add('HTTP transport');
      continue;
    }

    if (file === 'src/cli.ts') {
      add('CLI');
      continue;
    }

    if (file === 'src/index.ts' || file.startsWith('scripts/')) {
      add('public API');
      continue;
    }

    if (file.startsWith('modules/')) {
      add('module examples');
      continue;
    }

    if (file.startsWith('src/')) {
      add('core runtime');
      continue;
    }

    add('repo internals');
  }

  return labels;
}

function formatAreaList(labels) {
  if (labels.length === 0) {
    return 'bundled release changes';
  }

  if (labels.length === 1) {
    return `bundled release changes in ${labels[0]}`;
  }

  if (labels.length === 2) {
    return `bundled release changes across ${labels[0]} and ${labels[1]}`;
  }

  return `bundled release changes across ${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;
}

function loadCommits(tag, previousTag) {
  const rangeArgs = previousTag ? [`${previousTag}..${tag}`] : [tag];
  const raw = tryGit(['log', ...rangeArgs, '--format=%H%x09%s', '--no-merges']);

  if (!raw) {
    return [];
  }

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, subject] = line.split('\t');
      const files = loadChangedFiles(sha);
      if (isReleaseCommit(subject) && isVersionOnlyReleaseCommit(files)) {
        return null;
      }

      if (isReleaseCommit(subject)) {
        return {
          sha,
          heading: TYPE_HEADINGS.get('update'),
          text: formatAreaList(summarizeAreas(files)),
        };
      }

      const parsed = classifyCommit(subject);
      return {
        sha,
        heading: parsed.heading,
        text: parsed.text,
      };
    })
    .filter(Boolean);
}

function renderNotes(tag, previousTag, commits, repoUrl) {
  const lines = [`# ${tag}`, ''];

  if (commits.length === 0) {
    lines.push('No user-facing commits were detected since the previous release.', '');
  } else {
    lines.push('## Changes', '');
    const orderedHeadings = ['Features', 'Fixes', 'Updates', 'Documentation', 'Maintenance'];

    for (const heading of orderedHeadings) {
      const grouped = commits.filter((commit) => commit.heading === heading);
      if (grouped.length === 0) {
        continue;
      }

      lines.push(`### ${heading}`, '');
      for (const commit of grouped) {
        lines.push(formatCommitLine(commit, repoUrl));
      }
      lines.push('');
    }
  }

  if (previousTag && repoUrl) {
    lines.push(`Full Changelog: [${previousTag}...${tag}](${repoUrl}/compare/${previousTag}...${tag})`);
  } else if (!previousTag) {
    lines.push('Initial release.');
  }

  return `${lines.join('\n').trim()}\n`;
}

function main() {
  const { tag } = parseArgs(process.argv.slice(2));
  const repoUrl = normalizeGitHubRemote(tryGit(['remote', 'get-url', 'origin']));
  const previousTag = findPreviousTag(tag);
  const commits = loadCommits(tag, previousTag);
  process.stdout.write(renderNotes(tag, previousTag, commits, repoUrl));
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
