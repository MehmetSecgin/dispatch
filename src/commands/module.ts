import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { loadModuleRegistry, moduleInfo, hashDirectory } from '../modules/index.js';
import { loadModuleFromDir, loadModules } from '../modules/loader.js';
import { ModuleManifestSchema } from '../modules/manifest.js';
import { ModuleRegistry } from '../modules/registry.js';
import { readJson, requireFile } from '../utils/fs-json.js';
import type { GroupedTableGroup } from '../output/renderer.js';
import {
  createRenderer,
  isColorEnabled,
  renderGroupedTableString,
  shortenHomePath,
  uiSymbol,
} from '../output/renderer.js';
import { defaultUserModulesDir, inferJobFileKind } from '../data/run-data.js';
import { cliErrorFromCode, exitCodeForCliError, jsonErrorEnvelope } from '../core/errors.js';
import { JobCaseSchema } from '../core/schema.js';
import { validateJobCase } from '../job/validator.js';
import { summarizeDeclaredMemoryDependencies } from '../job/dependencies.js';
import { loadActionDefaults } from '../execution/action-defaults.js';

function findZipBinary(): string {
  return process.platform === 'win32' ? 'powershell' : 'zip';
}

function findUnzipBinary(): string {
  return process.platform === 'win32' ? 'powershell' : 'unzip';
}

function formatJobLine(kind: 'seed' | 'case', id: string, jobPath: string): string {
  const label = kind === 'seed' ? 'Seed job' : 'Case job';
  return `  - ${label.padEnd(8)} ${id} -> ${shortenHomePath(jobPath)}`;
}

function formatDeclaredMemoryDependency(input: {
  namespace: string;
  key: string;
  fill?: { module: string; job: string };
}): string {
  const location = `${input.namespace}.${input.key}`;
  return input.fill ? `${location} (seed: ${input.fill.module}:${input.fill.job})` : location;
}

function renderJobWithDependencies(job: { kind: 'seed' | 'case'; id: string; path: string }): string[] {
  const parsedJob = JobCaseSchema.safeParse(readJson(job.path));
  const lines = [formatJobLine(job.kind, job.id, job.path)];
  if (!parsedJob.success) return lines;

  return [
    ...lines,
    ...summarizeDeclaredMemoryDependencies(parsedJob.data).map(
      (dep) => `    memory: ${formatDeclaredMemoryDependency(dep)}`,
    ),
  ];
}

export function registerModuleCommands(program: Command): void {
  const moduleCmd = program.command('module').description('Module operations');

  moduleCmd
    .command('init')
    .description('Create a new module scaffold')
    .requiredOption('--name <module>')
    .option('--version <version>', 'Module version', '0.1.0')
    .requiredOption('--out <dir>')
    .action(async (cmd) => {
      const renderer = createRenderer({});
      const outDir = path.resolve(String(cmd.out));
      const name = String(cmd.name).trim();
      const version = String(cmd.version || '0.1.0').trim();
      if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Module name must match ^[a-z0-9-]+$');
      fs.mkdirSync(outDir, { recursive: true });
      const manifest = {
        name,
        version,
        entry: 'index.mjs',
        metadata: { generatedBy: 'dispatch module init' },
      };
      fs.writeFileSync(path.join(outDir, 'module.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      fs.writeFileSync(
        path.join(outDir, 'index.mjs'),
        [
          "import { z } from 'zod';",
          "import { defineAction, defineModule } from 'dispatchkit';",
          '',
          'export default defineModule({',
          `  name: '${name}',`,
          `  version: '${version}',`,
          '  actions: {',
          '    ping: defineAction({',
          "      description: 'Ping action scaffold.',",
          '      schema: z.object({}),',
          '      handler: async () => ({',
          "        response: { ok: true },",
          "        detail: 'pong',",
          '      }),',
          '    }),',
          '  },',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );
      renderer.line(`✓ Initialized module scaffold at ${shortenHomePath(outDir)}`);
    });

  moduleCmd
    .command('list')
    .description('List loaded modules and resolved actions')
    .action(async () => {
      const opts = program.opts();
      const renderer = createRenderer({ json: !!opts.json, color: isColorEnabled(opts) });
      const { registry, warnings } = await loadModuleRegistry();
      const conflicts = registry.listConflicts();
      const data = {
        warnings,
        conflicts,
        modules: registry.listModules().map(moduleInfo),
      };
      const color = isColorEnabled(opts);
      const groups: GroupedTableGroup[] = data.modules.map((module) => ({
        header: [module.name, `${module.layer} · ${module.actionCount} actions`],
        rows: module.actions.map((action) => [
          `  ${action.key.split('.').slice(1).join('.')}`,
          action.description ?? '',
        ]),
      }));
      renderer.render({
        json: data,
        human: [
          renderGroupedTableString(['Action', 'Description'], groups),
          ...conflicts.map(
            (c) =>
              `${uiSymbol('warning', color)} override ${c.actionKey}: ${c.previous.moduleName}@${c.previous.version} -> ${c.winner.moduleName}@${c.winner.version}`,
          ),
          ...warnings.map((w) => `${uiSymbol('warning', color)} ${w}`),
        ],
      });
    });

  moduleCmd
    .command('inspect')
    .description('Inspect one module')
    .argument('<name>')
    .action(async (moduleName) => {
      const opts = program.opts();
      const renderer = createRenderer({ json: !!opts.json });
      const { registry } = await loadModuleRegistry();
      const requestedName = String(moduleName ?? '').trim();
      if (!requestedName) throw new Error('Module name required');
      const mod = registry.listModules().find((m) => m.name === requestedName);
      if (!mod) throw new Error(`Module not found: ${requestedName}`);
      const out = {
        ...moduleInfo(mod),
      };
      const hash = mod.sourcePath.startsWith('builtin:') ? undefined : hashDirectory(mod.sourcePath);
      const outWithHash = hash ? { ...out, hash } : out;
      const caseJobs = outWithHash.jobs.filter((job) => job.kind === 'case');
      const seedJobs = outWithHash.jobs.filter((job) => job.kind === 'seed');
      renderer.render({
        json: outWithHash,
        human: [
          `Module:   ${outWithHash.name}@${outWithHash.version} (${outWithHash.layer})`,
          `Source:   ${shortenHomePath(outWithHash.sourcePath)}`,
          `Actions:  ${outWithHash.actionCount}`,
          `Jobs:     ${outWithHash.jobs.length} total`,
          ...outWithHash.actions.map((a) => `  - ${a.key}${a.description ? ` - ${a.description}` : ''}`),
          ...(caseJobs.length > 0 ? [`Case Jobs: ${caseJobs.length}`] : []),
          ...caseJobs.flatMap(renderJobWithDependencies),
          ...(seedJobs.length > 0 ? [`Seed Jobs: ${seedJobs.length}`] : []),
          ...seedJobs.flatMap(renderJobWithDependencies),
          ...(opts.verbose && hash ? [`Integrity:  ${hash}`] : []),
        ],
      });
    });

  moduleCmd
    .command('validate')
    .description('Validate module manifest and handlers')
    .requiredOption('--path <moduleDir>')
    .action(async (cmd) => {
      const opts = program.opts();
      const renderer = createRenderer({ json: !!opts.json });
      const moduleDir = path.resolve(cmd.path);
      const manifestPath = path.join(moduleDir, 'module.json');
      if (!fs.existsSync(manifestPath)) throw new Error(`Missing module.json at ${manifestPath}`);
      const raw = readJson(manifestPath);
      const parsed = ModuleManifestSchema.safeParse(raw);
      if (!parsed.success) {
        const out = {
          valid: false,
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        };
        renderer.render({
          json: jsonErrorEnvelope(cliErrorFromCode('USAGE_ERROR', 'module validation failed', out)),
          human: ['✗ Module validation failed', ...out.issues.map((i) => `  - ${i.path || '<root>'}: ${i.message}`)],
        });
        process.exitCode = exitCodeForCliError(cliErrorFromCode('USAGE_ERROR', 'module validation failed'));
        return;
      }
      const entryPath = path.resolve(moduleDir, parsed.data.entry || 'index.mjs');
      if (!fs.existsSync(entryPath)) throw new Error(`Missing entry file: ${entryPath}`);
      const moduleDef = await loadModuleFromDir(moduleDir, 'repo');
      const loaded = await loadModules();
      const registry = new ModuleRegistry();
      for (const mod of loaded.modules) {
        if (path.resolve(mod.sourcePath) === moduleDir) continue;
        registry.register(mod);
      }
      registry.register(moduleDef);
      const emptyDescriptions = Object.entries(moduleDef.actions)
        .filter(([, action]) => !action.description || !String(action.description).trim())
        .map(([name]) => name);
      const discoveredJobs = moduleDef.jobs ?? [];
      const jobIssues = discoveredJobs.flatMap((job) => {
        const parsedJob = JobCaseSchema.safeParse(readJson(job.path));
        if (!parsedJob.success) {
          return parsedJob.error.issues.map((issue) => ({
            jobId: job.id,
            kind: job.kind,
            path: `${job.id}:${issue.path.join('.') || '<root>'}`,
            message: issue.message,
          }));
        }
        const validated = validateJobCase(parsedJob.data, registry, loadActionDefaults(), {
          jobKind: inferJobFileKind(job.path),
        });
        return validated.issues.map((issue) => ({
          jobId: job.id,
          kind: job.kind,
          path: `${job.id}:${issue.path || '<root>'}`,
          message: issue.message,
        }));
      });
      const out = {
        valid: Object.keys(moduleDef.actions).length > 0 && emptyDescriptions.length === 0 && jobIssues.length === 0,
        module: parsed.data.name,
        version: parsed.data.version,
        hash: hashDirectory(moduleDir),
        actionCount: Object.keys(moduleDef.actions).length,
        emptyDescriptions,
        jobs: discoveredJobs,
        jobIssues,
      };
      renderer.render({
        json: out.valid ? out : jsonErrorEnvelope(cliErrorFromCode('USAGE_ERROR', 'module validation failed', out)),
        human: [
          `✓ Module valid -> ${out.module}@${out.version}`,
          ...(opts.verbose ? [`  Integrity: ${out.hash}`] : []),
          `  Actions: ${out.actionCount}`,
          ...(out.emptyDescriptions.length > 0 ? [`  Empty descriptions: ${out.emptyDescriptions.join(', ')}`] : []),
          ...(out.jobs.length > 0 ? [`  Jobs: ${out.jobs.map((job) => `[${job.kind}] ${job.id}`).join(', ')}`] : []),
          ...(out.jobIssues.length > 0 ? out.jobIssues.map((issue) => `  Job issue: ${issue.path}: ${issue.message}`) : []),
        ],
      });
      if (!out.valid)
        process.exitCode = exitCodeForCliError(cliErrorFromCode('USAGE_ERROR', 'module validation failed'));
    });

  const overrideCmd = moduleCmd.command('override').description('Override scaffolding');
  overrideCmd
    .command('init')
    .description('Initialize override module scaffold')
    .requiredOption('--from <module.action>')
    .requiredOption('--out <dir>')
    .action(async (cmd) => {
      const renderer = createRenderer({});
      const from = String(cmd.from);
      const outDir = path.resolve(cmd.out);
      const m = from.match(/^([a-z0-9-]+)\.([a-z0-9-]+)$/);
      if (!m) throw new Error('Expected --from <module.action>');
      const moduleName = `${m[1]}-override`;
      fs.mkdirSync(outDir, { recursive: true });
      const manifest = {
        name: moduleName,
        version: '0.1.0',
        entry: 'index.mjs',
        metadata: { extends: m[1], generatedBy: 'dispatch override-init' },
      };
      fs.writeFileSync(path.join(outDir, 'module.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      fs.writeFileSync(
        path.join(outDir, 'index.mjs'),
        [
          "import { z } from 'zod';",
          "import { defineAction, defineModule } from 'dispatchkit';",
          '',
          'export async function overrideAction(ctx, payload) {',
          `  throw new Error('Implement overrideAction in ${from}');`,
          '}',
          '',
          'export default defineModule({',
          `  name: '${moduleName}',`,
          "  version: '0.1.0',",
          '  actions: {',
          `    '${m[2]}': defineAction({`,
          `      description: 'Override for ${from}',`,
          '      schema: z.object({}),',
          '      handler: overrideAction,',
          '    }),',
          '  },',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );
      renderer.line(`✓ Created override skeleton at ${shortenHomePath(outDir)}`);
    });

  overrideCmd
    .command('add')
    .description('Add override action stub to module')
    .requiredOption('--module <module>')
    .requiredOption('--action <action>')
    .option('--path <dir>', 'Existing module path')
    .action(async (_cmd) => {
      throw new Error('override add is not supported for module-object authoring; edit the module entry directly');
    });

  moduleCmd
    .command('pack')
    .description('Pack a module directory into zip bundle')
    .requiredOption('--path <moduleDir>')
    .requiredOption('--out <bundle.dpmod.zip>')
    .action(async (cmd) => {
      const renderer = createRenderer({});
      const moduleDir = path.resolve(cmd.path);
      const outPath = path.resolve(cmd.out);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const zip = findZipBinary();
      if (zip === 'zip') {
        const r = spawnSync('zip', ['-rq', outPath, '.'], { cwd: moduleDir, encoding: 'utf8' });
        if (r.status !== 0) throw new Error(`zip failed: ${r.stderr || r.stdout}`);
      } else {
        throw new Error('zip packaging not supported on this platform in current build');
      }
      renderer.line(`✓ Packed ${shortenHomePath(outPath)}`);
    });

  moduleCmd
    .command('install')
    .description('Install module bundle into user module directory')
    .requiredOption('--bundle <bundle.dpmod.zip>')
    .action(async (cmd) => {
      const renderer = createRenderer({});
      const bundle = path.resolve(cmd.bundle);
      requireFile(bundle, 'bundle');
      const targetRoot = defaultUserModulesDir();
      fs.mkdirSync(targetRoot, { recursive: true });
      const tmp = path.join(targetRoot, `.tmp-install-${Date.now()}`);
      fs.mkdirSync(tmp, { recursive: true });

      const unzip = findUnzipBinary();
      if (unzip === 'unzip') {
        const r = spawnSync('unzip', ['-q', '-o', bundle, '-d', tmp], { encoding: 'utf8' });
        if (r.status !== 0) throw new Error(`unzip failed: ${r.stderr || r.stdout}`);
      } else {
        throw new Error('unzip install not supported on this platform in current build');
      }

      const manifestPath = path.join(tmp, 'module.json');
      if (!fs.existsSync(manifestPath)) throw new Error('Bundle missing module.json at root');
      const manifest = ModuleManifestSchema.parse(readJson(manifestPath));
      const installDir = path.join(targetRoot, `${manifest.name}@${manifest.version}`);
      fs.rmSync(installDir, { recursive: true, force: true });
      fs.renameSync(tmp, installDir);
      renderer.line(`✓ Installed ${manifest.name}@${manifest.version} -> ${shortenHomePath(installDir)}`);
    });

  moduleCmd
    .command('uninstall')
    .description('Uninstall module(s) from user module directory')
    .requiredOption('--name <module>')
    .option('--module-version <version>', 'Module version')
    .action(async (cmd) => {
      const renderer = createRenderer({});
      const root = defaultUserModulesDir();
      if (!fs.existsSync(root)) throw new Error('No installed modules directory found');
      const prefix = `${String(cmd.name)}@`;
      const entries = fs.readdirSync(root).filter((n) => n.startsWith(prefix));
      const matches = cmd.moduleVersion ? entries.filter((n) => n === `${cmd.name}@${cmd.moduleVersion}`) : entries;
      if (matches.length === 0) throw new Error('No matching installed module found');
      for (const m of matches) {
        fs.rmSync(path.join(root, m), { recursive: true, force: true });
        renderer.line(`✓ Removed ${m}`);
      }
    });
}
