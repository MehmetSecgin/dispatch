import fs from 'node:fs';
import { PROJECT_CONFIG_PATH, USER_CONFIG_PATH } from '../data/paths.js';
import { DispatchConfigSchema, type DispatchConfig } from './schema.js';

export interface ConfigLoadResult {
  config: DispatchConfig;
  warnings: string[];
}

type RawConfig = Record<string, unknown>;

function interpolateEnv(value: string): string {
  return value.replace(/\$\{env\.([^}]+)\}/g, (_match, name: string) => process.env[name] ?? '');
}

function interpolateConfig(value: unknown): unknown {
  if (typeof value === 'string') return interpolateEnv(value);
  if (Array.isArray(value)) return value.map((entry) => interpolateConfig(entry));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, interpolateConfig(entry)]));
}

function isRawConfig(value: unknown): value is RawConfig {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function formatIssues(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '<root>'}: ${issue.message}`)
    .join('; ');
}

function readConfigFile(filePath: string): { value: RawConfig | null; warnings: string[] } {
  if (!fs.existsSync(filePath)) return { value: null, warnings: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!isRawConfig(raw)) {
      return {
        value: null,
        warnings: [`[dispatch] Warning: config at ${filePath} must be a JSON object; ignoring file.`],
      };
    }
    return { value: raw, warnings: [] };
  } catch (error) {
    return {
      value: null,
      warnings: [`[dispatch] Warning: failed to read config at ${filePath}: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

function mergeConfig(userRaw: RawConfig, projectRaw: RawConfig): RawConfig {
  const userRegistry = isRawConfig(userRaw.registry) ? userRaw.registry : null;
  const projectRegistry = isRawConfig(projectRaw.registry) ? projectRaw.registry : null;
  const merged: RawConfig = {
    ...userRaw,
    ...projectRaw,
  };
  if (userRegistry || projectRegistry) {
    merged.registry = {
      ...(userRegistry ?? {}),
      ...(projectRegistry ?? {}),
    };
  }
  return merged;
}

let cached: ConfigLoadResult | null = null;

export function loadConfig(): ConfigLoadResult {
  if (cached) return {
    config: cached.config,
    warnings: [...cached.warnings],
  };

  const user = readConfigFile(USER_CONFIG_PATH);
  const project = readConfigFile(PROJECT_CONFIG_PATH);
  const warnings = [...user.warnings, ...project.warnings];
  const userRaw = user.value ?? {};
  const projectRaw = project.value ?? {};

  if (isRawConfig(projectRaw.registry) && typeof projectRaw.registry.authToken === 'string') {
    warnings.push(
      `[dispatch] Warning: authToken found in ${PROJECT_CONFIG_PATH}. Store auth tokens in ${USER_CONFIG_PATH} instead.`,
    );
  }

  const merged = mergeConfig(userRaw, projectRaw);
  const parsed = DispatchConfigSchema.safeParse(interpolateConfig(merged));
  if (!parsed.success) {
    cached = {
      config: {},
      warnings: [
        ...warnings,
        `[dispatch] Warning: dispatch config is invalid, ignoring merged config: ${formatIssues(parsed.error.issues)}`,
      ],
    };
    return {
      config: cached.config,
      warnings: [...cached.warnings],
    };
  }

  cached = {
    config: parsed.data,
    warnings,
  };
  return {
    config: cached.config,
    warnings: [...cached.warnings],
  };
}

export function resetConfigCache(): void {
  cached = null;
}
