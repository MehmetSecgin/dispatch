import { spawnSync } from 'node:child_process';
import { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import type { ModuleEntry } from '../config/schema.js';

type NamedModuleEntry = {
  name: string;
  entry: ModuleEntry;
};

function npxBinary(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function configuredModules(): Record<string, ModuleEntry> {
  const { config } = loadConfig();
  if (!config.modules || Object.keys(config.modules).length === 0) {
    throw new Error('No modules configured. Add a modules map to dispatch.config.json or ~/.dispatch/config.json.');
  }
  return config.modules;
}

function selectedModules(
  modules: Record<string, ModuleEntry>,
  name: string | undefined,
  all: boolean,
): NamedModuleEntry[] {
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (trimmedName && all) throw new Error('Provide either a module name or --all, not both.');
  if (!trimmedName && !all) throw new Error('Provide a module name or --all.');
  if (trimmedName) {
    const entry = modules[trimmedName];
    if (!entry) throw new Error(`Module not found in config.modules: ${trimmedName}`);
    return [{ name: trimmedName, entry }];
  }
  return Object.entries(modules)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([moduleName, entry]) => ({ name: moduleName, entry }));
}

function moduleRepoSpec(entry: ModuleEntry): string {
  return `${entry.repo}@${entry.version}`;
}

function runSkills(args: string[]): number {
  const result = spawnSync(npxBinary(), ['--yes', 'skills', ...args], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function installModuleSkill(entry: ModuleEntry): number {
  return runSkills(['add', moduleRepoSpec(entry), '-y']);
}

function updateModuleSkill(entry: ModuleEntry): number {
  // The upstream skills CLI supports project-wide `update`, but targeted updates
  // are effectively handled by re-adding the requested source.
  return runSkills(['add', moduleRepoSpec(entry), '-y']);
}

export function registerSkillCommands(program: Command): void {
  const skill = program.command('skill').description('Install and update agent skills for configured modules');

  skill
    .command('install')
    .description('Install one configured module skill or all configured module skills')
    .argument('[name]')
    .option('--all', 'Install skills for all configured modules', false)
    .action((name, cmd) => {
      const modules = configuredModules();
      for (const moduleEntry of selectedModules(modules, typeof name === 'string' ? name : undefined, !!cmd.all)) {
        const status = installModuleSkill(moduleEntry.entry);
        if (status !== 0) {
          process.exitCode = status;
          return;
        }
      }
    });

  skill
    .command('update')
    .description('Update one configured module skill or all configured module skills')
    .argument('[name]')
    .option('--all', 'Update skills for all configured modules', false)
    .action((name, cmd) => {
      const modules = configuredModules();
      const selected = selectedModules(modules, typeof name === 'string' ? name : undefined, !!cmd.all);
      if (selected.length > 1) {
        const status = runSkills(['update']);
        if (status !== 0) process.exitCode = status;
        return;
      }
      const [moduleEntry] = selected;
      const status = updateModuleSkill(moduleEntry.entry);
      if (status !== 0) process.exitCode = status;
    });
}
