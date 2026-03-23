import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import { loadModuleRegistry, moduleInfo, hashDirectory } from '../modules/index.js';
import { loadModuleFromDir, loadModules } from '../modules/loader.js';
import { basicInstalledModuleValidation, installPreparedModuleDir } from '../modules/install.js';
import {
  ArtifactPreparationError,
  INSTALLED_ARTIFACT_MANIFEST,
  normalizeModuleToArtifact,
} from '../modules/artifact.js';
import { ModuleManifest, ModuleManifestSchema } from '../modules/manifest.js';
import { fetchModuleFromRegistry } from '../modules/remote.js';
import { ModuleRegistry } from '../modules/registry.js';
import { findWorkspaceRoot, listWorkspaceModuleCandidates } from '../modules/workspace.js';
import { schemaToJsonSchema } from '../modules/schema-contracts.js';
import { readJson, requireFile } from '../utils/fs-json.js';
import type { GroupedTableGroup } from '../output/renderer.js';
import {
  createRenderer,
  isColorEnabled,
  renderGroupedTableString,
  shortenHomePath,
  uiSymbol,
} from '../output/renderer.js';
import { defaultRuntime, defaultUserModulesDir, inferJobFileKind } from '../data/run-data.js';
import { cliErrorFromCode, exitCodeForCliError, jsonErrorEnvelope } from '../core/errors.js';
import { JobCaseSchema } from '../core/schema.js';
import { validateJobCase } from '../job/validator.js';
import {
  inspectEffectiveJobHttpConfig,
  inspectHttpDependencies,
  summarizeDeclaredHttpDependencies,
  summarizeDeclaredMemoryDependencies,
} from '../job/dependencies.js';
import { inspectJobCredentials } from '../job/credentials.js';
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
    ...summarizeDeclaredHttpDependencies(parsedJob.data).map((dep) => `    http: http.${dep.path}`),
  ];
}

function formatActionLine(action: {
  key: string;
  description: string | null;
  exportsSchema: Record<string, unknown> | null;
  credentialSchema: Record<string, unknown> | null;
}): string[] {
  const lines = [`  - ${action.key}${action.description ? ` - ${action.description}` : ''}`];
  const exportsSummary = summarizeSchemaPropertiesFromJson(action.exportsSchema);
  if (exportsSummary) lines.push(`      exports: ${exportsSummary}`);
  const credentialSummary = summarizeSchemaPropertiesFromJson(action.credentialSchema);
  if (credentialSummary) lines.push(`      credentials: ${credentialSummary}`);
  return lines;
}

function summarizeSchemaPropertiesFromJson(jsonSchema: Record<string, unknown> | null): string | null {
  if (!jsonSchema) return null;
  const properties = jsonSchema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return 'declared';
  const entries = Object.entries(properties as Record<string, unknown>);
  if (entries.length === 0) return 'declared';
  return entries
    .map(([key, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return `${key}:unknown`;
      const node = value as Record<string, unknown>;
      const type = typeof node.type === 'string' ? node.type : 'unknown';
      return `${key}:${type}`;
    })
    .join(', ');
}

function parseSkillFrontmatterName(content: string): string | null {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!frontmatterMatch) return null;
  const nameMatch = frontmatterMatch[1].match(/^name:\s*(.+)\s*$/m);
  return nameMatch ? nameMatch[1].trim() : null;
}

function skillLockContainsName(lockPath: string, skillName: string): boolean {
  if (!fs.existsSync(lockPath) || !fs.statSync(lockPath).isFile()) return false;
  try {
    const raw = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const skills = (raw as { skills?: unknown }).skills;
    return !!skills && typeof skills === 'object' && !Array.isArray(skills) && skillName in skills;
  } catch {
    return false;
  }
}

function isRuntimeAssumptionHttpIssue(job: unknown, issue: { httpPath?: string; message: string }): boolean {
  if (!issue.httpPath) return false;
  const httpConfig = job && typeof job === 'object' ? (job as { http?: unknown }).http : null;
  if (!httpConfig || typeof httpConfig !== 'object' || Array.isArray(httpConfig)) return false;

  let current: unknown = httpConfig;
  for (const segment of issue.httpPath.split('.')) {
    if (!segment || !current || typeof current !== 'object' || Array.isArray(current)) return false;
    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === 'string' && /\$\{(?:env|run)\./.test(current);
}

function createArtifactTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(path.resolve(process.cwd()), `${prefix}-`));
}

function artifactIssueFromError(error: unknown): { code: string; message: string; path?: string } {
  if (error instanceof ArtifactPreparationError) {
    return {
      code: error.code,
      message: error.message,
      path: error.detailPath,
    };
  }
  return {
    code: 'bundle-failed',
    message: error instanceof Error ? error.message : String(error),
  };
}

function normalizeModuleRelativePath(input: string): string {
  return input
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '');
}

function ensureModuleSubpath(moduleDir: string, relPath: string): string {
  const normalized = normalizeModuleRelativePath(relPath);
  const fullPath = path.resolve(moduleDir, normalized);
  const relative = path.relative(moduleDir, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Pack path must stay inside the module directory: ${relPath}`);
  }
  return fullPath;
}

function collectFilesRecursively(root: string, currentDir: string, out: Set<string>): void {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectFilesRecursively(root, fullPath, out);
      continue;
    }
    if (!entry.isFile()) continue;
    out.add(normalizeModuleRelativePath(path.relative(root, fullPath)));
  }
}

function addModulePath(root: string, relPath: string, out: Set<string>): void {
  const fullPath = ensureModuleSubpath(root, relPath);
  if (!fs.existsSync(fullPath)) throw new Error(`Pack include path does not exist: ${relPath}`);
  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    collectFilesRecursively(root, fullPath, out);
    return;
  }
  if (stat.isFile()) {
    out.add(normalizeModuleRelativePath(path.relative(root, fullPath)));
    return;
  }
  throw new Error(`Unsupported pack path type: ${relPath}`);
}

function includedPackFiles(moduleDir: string, manifest: ModuleManifest): string[] {
  const out = new Set<string>();
  out.add('module.json');

  const entry = normalizeModuleRelativePath(manifest.entry || 'index.mjs');
  const entryDir = path.posix.dirname(entry);
  if (entryDir === '.') addModulePath(moduleDir, entry, out);
  else addModulePath(moduleDir, entryDir, out);

  const jobsDir = path.join(moduleDir, 'jobs');
  if (fs.existsSync(jobsDir) && fs.statSync(jobsDir).isDirectory()) addModulePath(moduleDir, 'jobs', out);

  const readmePath = path.join(moduleDir, 'README.md');
  if (fs.existsSync(readmePath) && fs.statSync(readmePath).isFile()) addModulePath(moduleDir, 'README.md', out);

  for (const pattern of manifest.pack?.include ?? []) {
    const normalized = normalizeModuleRelativePath(pattern);
    if (normalized.includes('*') && !normalized.endsWith('/**')) {
      throw new Error(`Unsupported pack include pattern '${pattern}'. Use a file path, directory path, or dir/**.`);
    }
    const target = normalized.endsWith('/**') ? normalized.slice(0, -3) : normalized;
    addModulePath(moduleDir, target, out);
  }

  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

function stageModuleBundle(moduleDir: string, stagingDir: string, manifest: ModuleManifest): void {
  for (const relPath of includedPackFiles(moduleDir, manifest)) {
    const src = path.join(moduleDir, relPath);
    const dst = path.join(stagingDir, relPath);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

function writeTextFiles(rootDir: string, files: Record<string, string>): void {
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(rootDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
  }
}

function createJavaScriptModuleScaffold(
  name: string,
  version: string,
): {
  manifest: ModuleManifest;
  files: Record<string, string>;
} {
  return {
    manifest: {
      name,
      version,
      entry: 'index.mjs',
      metadata: { generatedBy: 'dispatch module init' },
    },
    files: {
      'index.mjs': [
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
        '        response: { ok: true },',
        "        detail: 'pong',",
        '      }),',
        '    }),',
        '  },',
        '});',
        '',
      ].join('\n'),
    },
  };
}

function createTypeScriptModuleScaffold(
  name: string,
  version: string,
): {
  manifest: ModuleManifest;
  files: Record<string, string>;
} {
  return {
    manifest: {
      name,
      version,
      entry: 'dist/index.mjs',
      metadata: { generatedBy: 'dispatch module init --typescript' },
    },
    files: {
      'src/index.ts': [
        "import { defineAction, defineModule, type ActionContext, type ActionResult } from 'dispatchkit';",
        "import { PING_ACTIVITY } from './constants.js';",
        "import { PingSchema, type PingPayload } from './schemas.js';",
        '',
        'async function ping(ctx: ActionContext, _payload: PingPayload): Promise<ActionResult> {',
        '  ctx.artifacts.appendActivity(`${PING_ACTIVITY} ok=true`);',
        '  return {',
        '    response: { ok: true },',
        "    detail: 'pong',",
        '  };',
        '}',
        '',
        'export default defineModule({',
        `  name: '${name}',`,
        `  version: '${version}',`,
        '  actions: {',
        '    ping: defineAction({',
        "      description: 'Ping action scaffold.',",
        '      schema: PingSchema,',
        '      handler: ping,',
        '    }),',
        '  },',
        '});',
        '',
      ].join('\n'),
      'src/schemas.ts': [
        "import { z } from 'zod';",
        '',
        'export const PingSchema = z.object({});',
        '',
        'export type PingPayload = z.infer<typeof PingSchema>;',
        '',
      ].join('\n'),
      'src/constants.ts': ["export const PING_ACTIVITY = 'ping';", ''].join('\n'),
      'tsconfig.json': `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            esModuleInterop: true,
            resolveJsonModule: true,
            isolatedModules: true,
            skipLibCheck: true,
            noEmit: true,
          },
          include: ['src/**/*.ts', 'tsup.config.ts'],
        },
        null,
        2,
      )}\n`,
      'tsup.config.ts': [
        "import { defineConfig } from 'tsup';",
        '',
        'export default defineConfig({',
        "  entry: ['src/index.ts'],",
        "  format: ['esm'],",
        "  platform: 'node',",
        "  target: 'node20',",
        "  external: ['dispatchkit', 'zod'],",
        '  clean: true,',
        '  bundle: true,',
        "  outDir: 'dist',",
        '  outExtension() {',
        '    return {',
        "      js: '.mjs',",
        '    };',
        '  },',
        '});',
        '',
      ].join('\n'),
    },
  };
}

export function registerModuleCommands(program: Command, deps: { cliVersion: string }): void {
  const moduleCmd = program.command('module').description('Module operations');

  moduleCmd
    .command('init')
    .description('Create a new module scaffold')
    .requiredOption('--name <module>')
    .option('--version <version>', 'Module version', '0.1.0')
    .option('--typescript', 'Generate a TypeScript + tsup scaffold')
    .requiredOption('--out <dir>')
    .action(async (cmd) => {
      const renderer = createRenderer({});
      const outDir = path.resolve(String(cmd.out));
      const name = String(cmd.name).trim();
      const version = String(cmd.version || '0.1.0').trim();
      const useTypeScript = !!cmd.typescript;
      if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Module name must match ^[a-z0-9-]+$');
      fs.mkdirSync(outDir, { recursive: true });
      const scaffold = useTypeScript
        ? createTypeScriptModuleScaffold(name, version)
        : createJavaScriptModuleScaffold(name, version);
      writeTextFiles(outDir, {
        'module.json': `${JSON.stringify(scaffold.manifest, null, 2)}\n`,
        ...scaffold.files,
      });
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
        actions: Object.entries(mod.actions).map(([name, action]) => ({
          key: `${mod.name}.${name}`,
          description: action.description ?? null,
          schema: schemaToJsonSchema(action.schema),
          exportsSchema: schemaToJsonSchema(action.exportsSchema),
          credentialSchema: schemaToJsonSchema(action.credentialSchema),
        })),
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
          ...outWithHash.actions.flatMap(formatActionLine),
          ...(caseJobs.length > 0 ? [`Case Jobs: ${caseJobs.length}`] : []),
          ...caseJobs.flatMap(renderJobWithDependencies),
          ...(seedJobs.length > 0 ? [`Seed Jobs: ${seedJobs.length}`] : []),
          ...seedJobs.flatMap(renderJobWithDependencies),
          ...(opts.verbose && hash ? [`Integrity:  ${hash}`] : []),
        ],
      });
    });

  moduleCmd
    .command('skill')
    .description('Print SKILL.md from a module directory')
    .requiredOption('--path <dir>')
    .action(async (cmd) => {
      const moduleDir = path.resolve(String(cmd.path));
      const skillPath = path.join(moduleDir, 'SKILL.md');
      if (!fs.existsSync(skillPath) || !fs.statSync(skillPath).isFile()) {
        console.error(`No SKILL.md found at ${skillPath}`);
        process.exitCode = 1;
        return;
      }
      process.stdout.write(fs.readFileSync(skillPath, 'utf8'));
    });

  moduleCmd
    .command('bootstrap')
    .description('Install repo-local modules from a workspace into the user module directory')
    .option('--from <dir>', 'Workspace root (defaults to nearest repo with modules/)')
    .action(async (cmd) => {
      const opts = program.opts();
      const renderer = createRenderer({ json: !!opts.json, color: isColorEnabled(opts) });
      const fromDir = typeof cmd.from === 'string' && String(cmd.from).trim() ? path.resolve(String(cmd.from)) : process.cwd();
      const workspaceRoot = cmd.from ? fromDir : findWorkspaceRoot(fromDir);
      if (!workspaceRoot) throw new Error(`No workspace with modules/ found from ${shortenHomePath(fromDir)}`);

      const candidates = listWorkspaceModuleCandidates(workspaceRoot);
      if (candidates.length === 0) throw new Error(`No local modules found under ${shortenHomePath(path.join(workspaceRoot, 'modules'))}`);

      const installed = [];
      for (const candidate of candidates) {
        const artifactDir = createArtifactTempDir('.dispatch-bootstrap-artifact');
        try {
          await normalizeModuleToArtifact(candidate.moduleDir, artifactDir, { cliVersion: deps.cliVersion });
          const { manifest, installDir } = installPreparedModuleDir(artifactDir);
          installed.push({
            name: manifest.name,
            version: manifest.version,
            sourceDir: candidate.moduleDir,
            installDir,
          });
        } catch (error) {
          const issue = artifactIssueFromError(error);
          throw new Error(
            `Failed bootstrapping ${candidate.name}: ${issue.message}${issue.path ? ` (${issue.path})` : ''}`,
          );
        } finally {
          fs.rmSync(artifactDir, { recursive: true, force: true });
        }
      }

      renderer.render({
        json: {
          workspaceRoot,
          installed,
        },
        human: [
          `✓ Bootstrapped ${installed.length} local module${installed.length === 1 ? '' : 's'} from ${shortenHomePath(workspaceRoot)}`,
          ...installed.map(
            (entry) =>
              `  - ${entry.name}@${entry.version}: ${shortenHomePath(entry.sourceDir)} -> ${shortenHomePath(entry.installDir)}`,
          ),
        ],
      });
    });

  moduleCmd
    .command('validate')
    .description('Validate module manifest and handlers')
    .requiredOption('--path <moduleDir>')
    .action(async (cmd) => {
      const opts = program.opts();
      const color = isColorEnabled(opts);
      const renderer = createRenderer({ json: !!opts.json, color });
      const moduleDir = path.resolve(cmd.path);
      const manifestPath = path.join(moduleDir, 'module.json');
      if (!fs.existsSync(manifestPath)) throw new Error(`Missing module.json at ${manifestPath}`);
      const raw = readJson(manifestPath);
      const parsed = ModuleManifestSchema.safeParse(raw);
      if (!parsed.success) {
        const out = {
          module: path.basename(moduleDir),
          authoringValidity: {
            status: 'fail' as const,
            errors: parsed.error.issues.map((i) => ({ code: 'invalid-artifact-layout', path: i.path.join('.'), message: i.message })),
            warnings: [] as string[],
          },
          artifactReadiness: {
            status: 'fail' as const,
            errors: [{ code: 'invalid-artifact-layout', path: 'module.json', message: 'Authoring validity failed before artifact normalization could run' }],
            warnings: [] as string[],
          },
        };
        renderer.render({
          json: jsonErrorEnvelope(cliErrorFromCode('USAGE_ERROR', 'module validation failed', out)),
          human: [
            '✗ Module validation failed',
            'Authoring Validity:',
            ...out.authoringValidity.errors.map((i) => `  - ${i.path || '<root>'}: ${i.message}`),
            'Artifact Readiness:',
            ...out.artifactReadiness.errors.map((i) => `  - ${i.path || '<root>'}: ${i.message}`),
          ],
        });
        process.exitCode = exitCodeForCliError(cliErrorFromCode('USAGE_ERROR', 'module validation failed'));
        return;
      }
      let moduleDef: Awaited<ReturnType<typeof loadModuleFromDir>> | null = null;
      let emptyDescriptions: string[] = [];
      let discoveredJobs: Array<{ kind: 'seed' | 'case'; id: string; path: string }> = [];
      const jobWarnings: Array<{ jobId: string; kind: 'seed' | 'case'; path: string; message: string }> = [];
      const authoringErrors: Array<{ code: string; path?: string; message: string }> = [];

      try {
        moduleDef = await loadModuleFromDir(moduleDir, 'repo');
        const loaded = await loadModules({ searchFrom: [moduleDir] });
        const registry = new ModuleRegistry();
        for (const mod of loaded.modules) {
          if (path.resolve(mod.sourcePath) === moduleDir) continue;
          registry.register(mod);
        }
        registry.register(moduleDef);
        emptyDescriptions = Object.entries(moduleDef.actions)
          .filter(([, action]) => !action.description || !String(action.description).trim())
          .map(([name]) => name);
        discoveredJobs = moduleDef.jobs ?? [];
        authoringErrors.push(
          ...discoveredJobs.flatMap((job) => {
        const parsedJob = JobCaseSchema.safeParse(readJson(job.path));
        if (!parsedJob.success) {
          return parsedJob.error.issues.map((issue) => ({
            code: 'invalid-artifact-layout',
            jobId: job.id,
            kind: job.kind,
            path: `${job.id}:${issue.path.join('.') || '<root>'}`,
            message: issue.message,
          }));
        }
        const validated = validateJobCase(parsedJob.data, registry, loadActionDefaults(), {
          jobKind: inferJobFileKind(job.path),
        });
        const httpConfigCheck = inspectEffectiveJobHttpConfig(parsedJob.data, defaultRuntime('module-validate'));
        const httpDependencyCheck = httpConfigCheck.valid
          ? inspectHttpDependencies(parsedJob.data, httpConfigCheck.effectiveHttp)
          : { valid: false, issues: [] as Array<{ httpPath?: string; message: string }> };
        const credentialCheck = inspectJobCredentials(parsedJob.data, registry);
        const runtimeWarnings = [
          ...httpConfigCheck.issues
            .filter((issue) => isRuntimeAssumptionHttpIssue(parsedJob.data, issue))
            .map((issue) => ({
              jobId: job.id,
              kind: job.kind,
              path: `${job.id}:http.${issue.httpPath || '<root>'}`,
              message: `${issue.message} (runtime placeholder left unresolved during module validation)`,
            })),
          ...httpDependencyCheck.issues
            .filter((issue) => isRuntimeAssumptionHttpIssue(parsedJob.data, issue))
            .map((issue) => ({
              jobId: job.id,
              kind: job.kind,
              path: `${job.id}:http.${issue.httpPath || '<root>'}`,
              message: `${issue.message} (runtime placeholder left unresolved during module validation)`,
            })),
        ];
        jobWarnings.push(...runtimeWarnings);
        return [
          ...validated.issues.map((issue) => ({
            code: issue.code,
            jobId: job.id,
            kind: job.kind,
            path: `${job.id}:${issue.path || '<root>'}`,
            message: issue.message,
          })),
          ...httpConfigCheck.issues
            .filter((issue) => !isRuntimeAssumptionHttpIssue(parsedJob.data, issue))
            .map((issue) => ({
              code: issue.httpPath ? 'invalid-artifact-layout' : 'invalid-artifact-layout',
              jobId: job.id,
              kind: job.kind,
              path: `${job.id}:http.${issue.httpPath || '<root>'}`,
              message: issue.message,
            })),
          ...httpDependencyCheck.issues
            .filter((issue) => !isRuntimeAssumptionHttpIssue(parsedJob.data, issue))
            .map((issue) => ({
              code: 'invalid-artifact-layout',
              jobId: job.id,
              kind: job.kind,
              path: `${job.id}:http.${issue.httpPath || '<root>'}`,
              message: issue.message,
            })),
          ...credentialCheck.issues.map((issue) => ({
            code: issue.code,
            jobId: job.id,
            kind: job.kind,
            path: `${job.id}:${issue.path || '<root>'}`,
            message: issue.message,
          })),
        ];
          }),
        );
      } catch (error) {
        authoringErrors.push({
          code: 'invalid-artifact-layout',
          path: parsed.data.entry || 'index.mjs',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      const artifactWarnings: string[] = [];
      const artifactErrors: Array<{ code: string; path?: string; message: string }> = [];
      const artifactDir = createArtifactTempDir('.dispatch-validate-artifact');
      try {
        await normalizeModuleToArtifact(moduleDir, artifactDir, { cliVersion: deps.cliVersion });
      } catch (error) {
        artifactErrors.push(artifactIssueFromError(error));
      } finally {
        fs.rmSync(artifactDir, { recursive: true, force: true });
      }

      const out = {
        module: parsed.data.name,
        version: parsed.data.version,
        hash: hashDirectory(moduleDir),
        authoringValidity: {
          status:
            moduleDef !== null && Object.keys(moduleDef.actions).length > 0 && emptyDescriptions.length === 0 && authoringErrors.length === 0
              ? ('pass' as const)
              : ('fail' as const),
          errors: [
            ...emptyDescriptions.map((name) => ({
              code: 'invalid-artifact-layout',
              path: `actions.${name}.description`,
              message: `Action '${name}' is missing a description`,
            })),
            ...authoringErrors.map((issue) => ({
              code: issue.code,
              path: issue.path,
              message: issue.message,
            })),
          ],
          warnings: jobWarnings.map((warning) => `${warning.path}: ${warning.message}`),
        },
        artifactReadiness: {
          status: artifactErrors.length === 0 ? ('pass' as const) : ('fail' as const),
          errors: artifactErrors,
          warnings: artifactWarnings,
        },
        warnings: [] as string[],
      };
      const skillPath = path.join(moduleDir, 'SKILL.md');
      const configuredModule = loadConfig().config.modules?.[parsed.data.name];
      if (configuredModule?.repo && fs.existsSync(skillPath) && fs.statSync(skillPath).isFile()) {
        const skillContent = fs.readFileSync(skillPath, 'utf8');
        const skillName = parseSkillFrontmatterName(skillContent) ?? parsed.data.name;
        const skillLockPath = path.join(process.cwd(), 'skills-lock.json');
        if (!skillLockContainsName(skillLockPath, skillName)) {
          out.warnings.push(
            `SKILL.md found but skill does not appear installed. Run: dispatch skill install ${parsed.data.name}`,
          );
        }
      }
      renderer.render({
        json:
          out.authoringValidity.status === 'pass' && out.artifactReadiness.status === 'pass'
            ? out
            : jsonErrorEnvelope(cliErrorFromCode('USAGE_ERROR', 'module validation failed', out)),
        human: [
          `${out.authoringValidity.status === 'pass' && out.artifactReadiness.status === 'pass' ? '✓ Module valid' : '✗ Module validation failed'} -> ${out.module}@${out.version}`,
          ...(opts.verbose ? [`  Integrity: ${out.hash}`] : []),
          ...out.warnings.map((warning) => `${uiSymbol('warning', color)} ${warning}`),
          'Authoring Validity:',
          ...(out.authoringValidity.errors.length > 0
            ? out.authoringValidity.errors.map((issue) => `  - [${issue.code}] ${issue.path || '<root>'}: ${issue.message}`)
            : ['  - pass']),
          ...out.authoringValidity.warnings.map((warning) => `${uiSymbol('warning', color)} ${warning}`),
          'Artifact Readiness:',
          ...(out.artifactReadiness.errors.length > 0
            ? out.artifactReadiness.errors.map((issue) => `  - [${issue.code}] ${issue.path || '<root>'}: ${issue.message}`)
            : ['  - pass']),
          ...out.artifactReadiness.warnings.map((warning) => `${uiSymbol('warning', color)} ${warning}`),
        ],
      });
      if (out.authoringValidity.status !== 'pass' || out.artifactReadiness.status !== 'pass')
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
      const opts = program.opts();
      const renderer = createRenderer({ json: !!opts.json, color: isColorEnabled(opts) });
      const moduleDir = path.resolve(cmd.path);
      const outPath = path.resolve(cmd.out);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const stagingDir = fs.mkdtempSync(path.join(path.dirname(outPath), '.dispatch-pack-'));
      const zip = findZipBinary();
      try {
        await normalizeModuleToArtifact(moduleDir, stagingDir, { cliVersion: deps.cliVersion });
        fs.rmSync(outPath, { force: true });
        if (zip === 'zip') {
          const r = spawnSync('zip', ['-rq', outPath, '.'], { cwd: stagingDir, encoding: 'utf8' });
          if (r.status !== 0) throw new Error(`zip failed: ${r.stderr || r.stdout}`);
        } else {
          throw new Error('zip packaging not supported on this platform in current build');
        }
      } finally {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      }
      renderer.render({
        json: { bundlePath: outPath },
        human: `✓ Packed ${shortenHomePath(outPath)}`,
      });
    });

  moduleCmd
    .command('install')
    .description('Install module bundle into user module directory')
    .option('--bundle <bundle.dpmod.zip>')
    .option('--name <module>', 'Registry module name')
    .option('--version <version>', 'Registry module version')
    .action(async (cmd) => {
      const opts = program.opts();
      const renderer = createRenderer({ json: !!opts.json, color: isColorEnabled(opts) });
      const hasBundle = typeof cmd.bundle === 'string' && String(cmd.bundle).trim().length > 0;
      const hasName = typeof cmd.name === 'string' && String(cmd.name).trim().length > 0;
      const hasVersion = typeof cmd.version === 'string' && String(cmd.version).trim().length > 0;

      if ((hasName && !hasVersion) || (!hasName && hasVersion)) {
        throw new Error('Provide both --name and --version for registry installs');
      }
      if ((hasBundle && hasName) || (hasBundle && hasVersion)) {
        throw new Error('Provide either --bundle or --name with --version, not both');
      }
      if (!hasBundle && !hasName) {
        throw new Error('Provide either --bundle <bundle.dpmod.zip> or --name <module> --version <version>');
      }

      if (hasBundle) {
        const bundle = path.resolve(String(cmd.bundle));
        requireFile(bundle, 'bundle');
        const tmp = fs.mkdtempSync(path.join(path.dirname(bundle), '.dispatch-install-'));
        try {
          const unzip = findUnzipBinary();
          if (unzip === 'unzip') {
            const r = spawnSync('unzip', ['-q', '-o', bundle, '-d', tmp], { encoding: 'utf8' });
            if (r.status !== 0) throw new Error(`unzip failed: ${r.stderr || r.stdout}`);
          } else {
            throw new Error('unzip install not supported on this platform in current build');
          }

          const { manifest, installDir } = installPreparedModuleDir(tmp);
          renderer.render({
            json: { name: manifest.name, version: manifest.version, installDir },
            human: `✓ Installed ${manifest.name}@${manifest.version} -> ${shortenHomePath(installDir)}`,
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
        return;
      }

      const { config, warnings } = loadConfig();
      if (!config.registry) {
        throw new Error('No registry configured. Add a registry to dispatch.config.json or ~/.dispatch/config.json.');
      }

      const name = String(cmd.name).trim();
      const version = String(cmd.version).trim();
      const installDir = await fetchModuleFromRegistry(name, version, config.registry);
      renderer.render({
        json: { warnings, name, version, installDir },
        human: [
          ...warnings.map((warning) => `${uiSymbol('warning', isColorEnabled(opts))} ${warning}`),
          `✓ Installed ${name}@${version} -> ${shortenHomePath(installDir)}`,
        ],
      });
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
