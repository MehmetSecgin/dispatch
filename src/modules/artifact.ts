import { build, version as esbuildVersion } from 'esbuild';
import { builtinModules } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModuleManifestSchema, type ModuleManifest } from './manifest.js';
import { readJson } from '../utils/fs-json.js';

export const ARTIFACT_SCHEMA_VERSION = 1;
export const INSTALLED_ARTIFACT_ENTRY = 'dist/index.mjs';
export const INSTALLED_ARTIFACT_MANIFEST = 'artifact.json';

const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

export type ArtifactReadinessCode =
  | 'missing-entry'
  | 'unresolved-runtime-import'
  | 'bundle-failed'
  | 'invalid-artifact-layout'
  | 'legacy-installed-format';

export interface ArtifactIssue {
  code: ArtifactReadinessCode;
  message: string;
  path?: string;
}

export interface ArtifactManifest {
  artifactSchemaVersion: number;
  moduleName: string;
  moduleVersion: string;
  sourceEntry: string;
  bundledEntry: string;
  cliVersion: string;
  normalizedAt: string;
  sourceHash: string;
  bundler: string;
  bundlerVersion: string;
}

export interface ArtifactCheckResult {
  status: 'pass' | 'fail';
  errors: ArtifactIssue[];
  warnings: string[];
  manifest?: ArtifactManifest;
}

export class ArtifactPreparationError extends Error {
  readonly code: ArtifactReadinessCode;
  readonly detailPath?: string;

  constructor(code: ArtifactReadinessCode, message: string, detailPath?: string) {
    super(message);
    this.name = 'ArtifactPreparationError';
    this.code = code;
    this.detailPath = detailPath;
  }
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function hashDirectory(dir: string): string {
  const hash = createHash('sha256');
  const files = walkFiles(dir).sort((a, b) => a.localeCompare(b));
  for (const file of files) {
    const rel = path.relative(dir, file);
    hash.update(rel);
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function normalizeRelPath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ensureModuleSubpath(moduleDir: string, relPath: string): string {
  const normalized = normalizeRelPath(relPath);
  const fullPath = path.resolve(moduleDir, normalized);
  const relative = path.relative(moduleDir, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ArtifactPreparationError('invalid-artifact-layout', `Artifact path must stay inside the module directory: ${relPath}`);
  }
  return fullPath;
}

function copyDeclaredAssets(moduleDir: string, manifest: ModuleManifest, artifactDir: string): void {
  const patterns = manifest.pack?.include ?? [];
  if (patterns.length === 0) return;
  const assetsRoot = path.join(artifactDir, 'assets');
  ensureDir(assetsRoot);

  for (const pattern of patterns) {
    const normalized = normalizeRelPath(pattern);
    if (normalized.includes('*') && !normalized.endsWith('/**')) {
      throw new ArtifactPreparationError(
        'invalid-artifact-layout',
        `Unsupported pack include pattern '${pattern}'. Use a file path, directory path, or dir/**.`,
        'module.json',
      );
    }
    const target = normalized.endsWith('/**') ? normalized.slice(0, -3) : normalized;
    const sourcePath = ensureModuleSubpath(moduleDir, target);
    if (!fs.existsSync(sourcePath)) {
      throw new ArtifactPreparationError(
        'invalid-artifact-layout',
        `Pack include path does not exist: ${pattern}`,
        'module.json',
      );
    }

    const destinationPath = path.join(assetsRoot, normalizeRelPath(path.relative(moduleDir, sourcePath)));
    if (fs.statSync(sourcePath).isDirectory()) fs.cpSync(sourcePath, destinationPath, { recursive: true });
    else {
      ensureDir(path.dirname(destinationPath));
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function copyJobs(moduleDir: string, artifactDir: string): void {
  const jobsDir = path.join(moduleDir, 'jobs');
  if (!fs.existsSync(jobsDir) || !fs.statSync(jobsDir).isDirectory()) return;
  fs.cpSync(jobsDir, path.join(artifactDir, 'jobs'), { recursive: true });
}

function collectImportSpecifiers(source: string): string[] {
  const staticImports = Array.from(source.matchAll(/\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g)).map(
    (match) => match[1],
  );
  const dynamicImports = Array.from(source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)).map((match) => match[1]);
  return [...staticImports, ...dynamicImports];
}

function isAllowedInstalledImport(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../') || NODE_BUILTINS.has(specifier);
}

function assertPortableInstalledOutput(entryPath: string): void {
  const content = fs.readFileSync(entryPath, 'utf8');
  const disallowed = collectImportSpecifiers(content).filter((specifier) => !isAllowedInstalledImport(specifier));
  if (disallowed.length === 0) return;
  throw new ArtifactPreparationError(
    'unresolved-runtime-import',
    `Installed artifact leaves unresolved runtime import '${disallowed[0]}'`,
    INSTALLED_ARTIFACT_ENTRY,
  );
}

function findNearestPackageRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readPackageJson(pkgPath: string): Record<string, unknown> | null {
  try {
    const pkg = readJson(pkgPath);
    return pkg && typeof pkg === 'object' && !Array.isArray(pkg) ? (pkg as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function firstExistingFile(rootDir: string, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const fullPath = path.join(rootDir, candidate);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) return fullPath;
  }
  return null;
}

function collectSelfPackageSourceCandidates(pkg: Record<string, unknown>): string[] {
  const candidates: string[] = [];
  const pushCandidate = (value: unknown) => {
    if (typeof value !== 'string') return;
    const trimmed = normalizeRelPath(value.trim());
    if (!trimmed) return;
    candidates.push(trimmed);
  };

  pushCandidate(pkg.source);
  const exportsField = pkg.exports;
  if (exportsField && typeof exportsField === 'object' && !Array.isArray(exportsField)) {
    pushCandidate((exportsField as Record<string, unknown>)['source']);
    const rootExport = (exportsField as Record<string, unknown>)['.'];
    if (rootExport && typeof rootExport === 'object' && !Array.isArray(rootExport)) {
      pushCandidate((rootExport as Record<string, unknown>).source);
    }
  }

  candidates.push(
    'src/index.ts',
    'src/index.mts',
    'src/index.js',
    'src/index.mjs',
    'index.ts',
    'index.mts',
    'index.js',
    'index.mjs',
  );

  return Array.from(new Set(candidates));
}

function findSelfPackageSource(moduleDir: string): { packageName: string; sourceEntryPath: string } | null {
  const packageRoot = findNearestPackageRoot(moduleDir);
  if (!packageRoot) return null;

  const pkg = readPackageJson(path.join(packageRoot, 'package.json'));
  if (!pkg || typeof pkg.name !== 'string' || !pkg.name.trim()) return null;

  const sourceEntryPath = firstExistingFile(packageRoot, collectSelfPackageSourceCandidates(pkg));
  if (!sourceEntryPath) return null;

  return {
    packageName: pkg.name.trim(),
    sourceEntryPath,
  };
}

export async function normalizeModuleToArtifact(
  moduleDir: string,
  artifactDir: string,
  opts: { cliVersion: string },
): Promise<ArtifactManifest> {
  const manifest = ModuleManifestSchema.parse(readJson(path.join(moduleDir, 'module.json')));
  const sourceEntry = normalizeRelPath(manifest.entry || 'index.mjs');
  const sourceEntryPath = path.resolve(moduleDir, sourceEntry);

  if (!fs.existsSync(sourceEntryPath) || !fs.statSync(sourceEntryPath).isFile()) {
    throw new ArtifactPreparationError('missing-entry', `Missing module entry: ${sourceEntryPath}`, 'module.json');
  }

  fs.rmSync(artifactDir, { recursive: true, force: true });
  ensureDir(path.join(artifactDir, 'dist'));
  const selfPackageSource = findSelfPackageSource(moduleDir);

  try {
    await build({
      entryPoints: [sourceEntryPath],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
      outfile: path.join(artifactDir, INSTALLED_ARTIFACT_ENTRY),
      logLevel: 'silent',
      absWorkingDir: moduleDir,
      plugins: [
        {
          name: 'dispatch-file-url-imports',
          setup(buildCtx) {
            buildCtx.onResolve({ filter: /^file:\/\// }, (args) => ({
              path: fileURLToPath(args.path),
            }));
          },
        },
        ...(selfPackageSource
          ? [
              {
                name: 'dispatch-self-package-source',
                setup(buildCtx: import('esbuild').PluginBuild) {
                  buildCtx.onResolve(
                    { filter: new RegExp(`^${escapeRegExp(selfPackageSource.packageName)}$`) },
                    () => ({
                      path: selfPackageSource.sourceEntryPath,
                    }),
                  );
                },
              },
            ]
          : []),
      ],
    });
  } catch (error) {
    throw new ArtifactPreparationError(
      'bundle-failed',
      `Failed bundling runtime entry '${sourceEntry}': ${error instanceof Error ? error.message : String(error)}`,
      sourceEntry,
    );
  }

  assertPortableInstalledOutput(path.join(artifactDir, INSTALLED_ARTIFACT_ENTRY));
  copyJobs(moduleDir, artifactDir);
  copyDeclaredAssets(moduleDir, manifest, artifactDir);

  const installedManifest: ModuleManifest = {
    name: manifest.name,
    version: manifest.version,
    entry: INSTALLED_ARTIFACT_ENTRY,
    metadata: manifest.metadata,
  };
  fs.writeFileSync(path.join(artifactDir, 'module.json'), `${JSON.stringify(installedManifest, null, 2)}\n`, 'utf8');

  const artifactManifest: ArtifactManifest = {
    artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
    moduleName: manifest.name,
    moduleVersion: manifest.version,
    sourceEntry,
    bundledEntry: INSTALLED_ARTIFACT_ENTRY,
    cliVersion: opts.cliVersion,
    normalizedAt: new Date().toISOString(),
    sourceHash: hashDirectory(moduleDir),
    bundler: 'esbuild',
    bundlerVersion: esbuildVersion,
  };
  fs.writeFileSync(path.join(artifactDir, INSTALLED_ARTIFACT_MANIFEST), `${JSON.stringify(artifactManifest, null, 2)}\n`, 'utf8');

  return artifactManifest;
}

export function inspectInstalledArtifactDir(moduleDir: string): ArtifactCheckResult {
  const moduleJsonPath = path.join(moduleDir, 'module.json');
  if (!fs.existsSync(moduleJsonPath)) {
    return {
      status: 'fail',
      errors: [{ code: 'invalid-artifact-layout', message: 'Installed module is missing module.json', path: 'module.json' }],
      warnings: [],
    };
  }

  let manifest: ModuleManifest;
  try {
    manifest = ModuleManifestSchema.parse(readJson(moduleJsonPath));
  } catch (error) {
    return {
      status: 'fail',
      errors: [
        {
          code: 'invalid-artifact-layout',
          message: `Installed module has invalid module.json: ${error instanceof Error ? error.message : String(error)}`,
          path: 'module.json',
        },
      ],
      warnings: [],
    };
  }

  const artifactManifestPath = path.join(moduleDir, INSTALLED_ARTIFACT_MANIFEST);
  if (!fs.existsSync(artifactManifestPath) || manifest.entry !== INSTALLED_ARTIFACT_ENTRY) {
    return {
      status: 'fail',
      errors: [
        {
          code: 'legacy-installed-format',
          message:
            'This installed module uses the old non-portable format. Run dispatch module bootstrap --from <repo> or reinstall it.',
          path: !fs.existsSync(artifactManifestPath) ? INSTALLED_ARTIFACT_MANIFEST : 'module.json',
        },
      ],
      warnings: [],
    };
  }

  let artifactManifest: ArtifactManifest;
  try {
    artifactManifest = readJson<ArtifactManifest>(artifactManifestPath);
  } catch (error) {
    return {
      status: 'fail',
      errors: [
        {
          code: 'invalid-artifact-layout',
          message: `Installed artifact has invalid artifact.json: ${error instanceof Error ? error.message : String(error)}`,
          path: INSTALLED_ARTIFACT_MANIFEST,
        },
      ],
      warnings: [],
    };
  }

  const entryPath = path.join(moduleDir, INSTALLED_ARTIFACT_ENTRY);
  if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
    return {
      status: 'fail',
      errors: [{ code: 'invalid-artifact-layout', message: 'Installed artifact is missing dist/index.mjs', path: INSTALLED_ARTIFACT_ENTRY }],
      warnings: [],
    };
  }

  try {
    assertPortableInstalledOutput(entryPath);
  } catch (error) {
    if (error instanceof ArtifactPreparationError) {
      return {
        status: 'fail',
        errors: [{ code: error.code, message: error.message, path: error.detailPath }],
        warnings: [],
        manifest: artifactManifest,
      };
    }
    throw error;
  }

  return {
    status: 'pass',
    errors: [],
    warnings: [],
    manifest: artifactManifest,
  };
}
