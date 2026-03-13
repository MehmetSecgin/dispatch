#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs';
import packageJson from '../package.json' with { type: 'json' };
import { registerJobCommands } from './commands/job.js';
import { registerModuleCommands } from './commands/module.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { buildCompletionTree, collectCommands, renderCompletion } from './commands/completion.js';
import { getActionDefaultsPath, loadActionDefaults, saveActionDefaults } from './execution/action-defaults.js';
import { getRuntimeOverridesPath, loadRuntimeOverrides, saveRuntimeOverrides } from './execution/runtime-overrides.js';
import { defaultRuntime } from './data/run-data.js';
import { createRenderer, formatCliError, isColorEnabled, paint } from './output/renderer.js';
import { loadModuleRegistry } from './modules/index.js';
import {
  listMemoryNamespaces,
  readMemoryNamespace,
  resolveMemoryPath,
  resolveMemoryRoot,
} from './modules/builtin/memory/store.js';
import { readJson } from './utils/fs-json.js';
import { cliErrorFromCode, exitCodeForCliError, jsonErrorEnvelope } from './core/errors.js';
import { SKILL_VERSION } from './generated/skill-version.js';
import { schemaToJsonSchema } from './modules/schema-contracts.js';
import { ensureDispatchHomeDir, parseDispatchHomeArg, setDispatchHomeOverride } from './state/home.js';

const CLI_VERSION = packageJson.version;

async function main(): Promise<void> {
  if (process.argv.includes('--skill-version')) {
    createRenderer({}).line(SKILL_VERSION);
    return;
  }

  const program = new Command();
  program
    .name('dispatch')
    .description('Deterministic dispatch CLI with flow-first orchestration')
    .version(CLI_VERSION, '-V, --cli-version', 'Output CLI version')
    .option('--home <dir>', 'Override the dispatch state directory')
    .option('--llms', 'Print compact command manifest for agent discovery', false)
    .option('--json', 'Output machine JSON only', false)
    .option('--verbose', 'Show extended human output', false)
    .option('--no-color', 'Disable colorized human output');

  program.hook('preAction', (_thisCommand, actionCommand) => {
    const opts = actionCommand.optsWithGlobals<{ home?: string }>();
    setDispatchHomeOverride(opts.home);
    if (opts.home) ensureDispatchHomeDir();
  });

  registerJobCommands(program, { cliVersion: CLI_VERSION });
  registerModuleCommands(program);
  registerDoctorCommand(program, { cliVersion: CLI_VERSION });

  program
    .command('version')
    .description('Print CLI version')
    .action(() => {
      createRenderer({}).line(`dispatch v${CLI_VERSION}`);
    });

  program
    .command('skill-version')
    .description('Print baked skill version')
    .action(() => {
      createRenderer({}).line(SKILL_VERSION);
    });

  program
    .command('completion')
    .description('Print shell completion script')
    .argument('<shell>', 'bash | zsh | fish')
    .action((shell: string) => {
      const tree = buildCompletionTree(program);
      const script = renderCompletion(shell, tree);
      createRenderer({}).stdout(script);
    });

  program
    .command('self-check')
    .description('Run local checks for module loading')
    .action(async () => {
      const opts = program.opts();
      const color = isColorEnabled(opts);
      const renderer = createRenderer({ json: !!opts.json, color });
      const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

      try {
        const loaded = await loadModuleRegistry();
        results.push({
          name: 'module registry',
          ok: true,
          detail: `${loaded.registry.listModules().length} modules`,
        });
      } catch (err) {
        results.push({
          name: 'module registry',
          ok: false,
          detail: err instanceof Error ? err.message : String(err),
        });
      }

      const ok = results.every((r) => r.ok);
      renderer.render({
        json: ok
          ? { ok, results }
          : jsonErrorEnvelope(
              cliErrorFromCode('RUNTIME_ERROR', 'self-check failed', {
                results,
              }),
            ),
        human: results.map((result) => {
          const prefix = result.ok ? paint('✓', 'success', color) : paint('✗', 'error', color);
          return `${prefix} ${result.name}${result.detail ? ` (${result.detail})` : ''}`;
        }),
      });
      if (!ok) process.exitCode = exitCodeForCliError(cliErrorFromCode('RUNTIME_ERROR', 'self-check failed'));
    });

  const runtime = program.command('runtime').description('Manage runtime overrides');
  runtime
    .command('show')
    .description('Show runtime overrides')
    .action(() => {
      const opts = program.opts();
      const renderer = createRenderer({ json: !!opts.json });
      const out = {
        path: getRuntimeOverridesPath(),
        values: loadRuntimeOverrides(),
      };
      renderer.render({ json: out, human: JSON.stringify(out, null, 2) });
    });

  runtime
    .command('unset')
    .description('Unset runtime override keys')
    .option('--all', 'Unset all override keys')
    .action((cmd) => {
      const opts = program.opts();
      const renderer = createRenderer({
        json: !!opts.json,
        color: isColorEnabled(opts),
      });
      const next = cmd.all ? {} : loadRuntimeOverrides();
      if (cmd.all) saveRuntimeOverrides(next);
      renderer.render({
        json: { path: getRuntimeOverridesPath(), values: next },
        human: paint('✓ runtime overrides updated', 'success', isColorEnabled(opts)),
      });
    });

  const defaults = program.command('defaults').description('Manage action defaults');
  defaults
    .command('show')
    .description('Show action defaults')
    .option('--action <module.action>')
    .action((cmd) => {
      const opts = program.opts();
      const renderer = createRenderer({ json: !!opts.json });
      const all = loadActionDefaults();
      const values = cmd.action ? { [cmd.action]: all[cmd.action] } : all;
      const out = { path: getActionDefaultsPath(), values };
      renderer.render({ json: out, human: JSON.stringify(out, null, 2) });
    });

  defaults
    .command('set')
    .description('Set defaults for one action')
    .requiredOption('--action <module.action>')
    .requiredOption('--file <path>')
    .action((cmd) => {
      const opts = program.opts();
      const renderer = createRenderer({
        json: !!opts.json,
        color: isColorEnabled(opts),
      });
      const data = loadActionDefaults();
      data[String(cmd.action)] = readJson(cmd.file);
      saveActionDefaults(data);
      renderer.render({
        json: { path: getActionDefaultsPath(), values: data },
        human: paint('✓ defaults updated', 'success', isColorEnabled(opts)),
      });
    });

  defaults
    .command('unset')
    .description('Unset defaults for one action')
    .requiredOption('--action <module.action>')
    .action((cmd) => {
      const opts = program.opts();
      const renderer = createRenderer({
        json: !!opts.json,
        color: isColorEnabled(opts),
      });
      const data = loadActionDefaults();
      delete data[String(cmd.action)];
      saveActionDefaults(data);
      renderer.render({
        json: { path: getActionDefaultsPath(), values: data },
        human: paint('✓ defaults updated', 'success', isColorEnabled(opts)),
      });
    });

  const memory = program.command('memory').description('Inspect persistent memory namespaces');
  memory
    .command('list')
    .description('List memory namespaces')
    .action(() => {
      const opts = program.opts();
      const renderer = createRenderer({
        json: !!opts.json,
        color: isColorEnabled(opts),
      });
      const configDir = defaultRuntime(CLI_VERSION).configDir;
      const namespaces = listMemoryNamespaces(configDir).map((entry) => ({
        namespace: entry.namespace,
        path: entry.path,
      }));
      const out = {
        root: resolveMemoryRoot(configDir),
        namespaces,
      };
      renderer.render({
        json: out,
        human:
          namespaces.length === 0
            ? [`Memory root: ${out.root}`, 'No memory namespaces found.']
            : [`Memory root: ${out.root}`, ...namespaces.map((entry) => `- ${entry.namespace}  ${entry.path}`)],
      });
    });

  memory
    .command('inspect')
    .description('Inspect one memory namespace')
    .requiredOption('--namespace <name>')
    .action((cmd) => {
      const opts = program.opts();
      const renderer = createRenderer({
        json: !!opts.json,
        color: isColorEnabled(opts),
      });
      const configDir = defaultRuntime(CLI_VERSION).configDir;
      const namespace = String(cmd.namespace).trim();
      const filePath = resolveMemoryPath(configDir, namespace);
      if (!fs.existsSync(filePath)) {
        const message = `Memory namespace not found: ${namespace}`;
        renderer.render({
          json: jsonErrorEnvelope(cliErrorFromCode('NOT_FOUND', message)),
          human: `Error: ${message}`,
        });
        process.exitCode = exitCodeForCliError(cliErrorFromCode('NOT_FOUND', message));
        return;
      }
      const out = {
        namespace,
        path: filePath,
        values: readMemoryNamespace(configDir, namespace),
      };
      renderer.render({
        json: out,
        human: [`Namespace: ${namespace}`, `Path:      ${filePath}`, JSON.stringify(out.values, null, 2)],
      });
    });

  const schema = program.command('schema').description('Print canonical JSON schemas');
  schema
    .command('case')
    .description('Print case schema example')
    .requiredOption('--print', 'Print schema object')
    .action((cmd) => {
      if (!cmd.print) throw new Error('Use --print to output schema');
      createRenderer({ json: true }).jsonOut({
        schemaVersion: 1,
        jobType: 'example',
        scenario: {
          steps: [{ id: 'step_1', action: 'flow.sleep', payload: { duration: '1s' } }],
        },
      });
    });

  schema
    .command('action')
    .description('Print minimal schema for an action')
    .requiredOption('--name <module.action>')
    .requiredOption('--print', 'Print schema object')
    .action(async (cmd) => {
      if (!cmd.print) throw new Error('Use --print to output schema');
      const { registry } = await loadModuleRegistry();
      const resolved = registry.resolve(String(cmd.name));
      if (!resolved) throw new Error(`Unknown action: ${cmd.name}`);
      createRenderer({ json: true }).jsonOut({
        action: cmd.name,
        module: resolved.moduleName,
        description: resolved.definition.description ?? null,
        inputSchema: schemaToJsonSchema(resolved.definition.schema),
        exportsSchema: schemaToJsonSchema(resolved.definition.exportsSchema),
        credentialSchema: schemaToJsonSchema(resolved.definition.credentialSchema),
      });
    });

  if (process.argv.includes('--llms')) {
    const homeOverride = parseDispatchHomeArg(process.argv.slice(2));
    setDispatchHomeOverride(homeOverride);
    if (homeOverride) ensureDispatchHomeDir();
    const exclude = new Set(['version', 'skill-version', 'completion', 'self-check', 'help']);
    const commands = collectCommands(program, { exclude });
    const { registry } = await loadModuleRegistry();
    const actions = registry
      .listModules()
      .flatMap((module) =>
        Object.entries(module.actions).map(([actionName, action]) => ({
          key: `${module.name}.${actionName}`,
          desc: action.description ?? null,
        })),
      )
      .sort((a, b) => a.key.localeCompare(b.key));
    const manifest = {
      version: CLI_VERSION,
      hint: 'Every command returns a next[] array suggesting follow-up commands.',
      commands,
      actions,
    };
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  const opts = process.argv.includes('--json');
  const renderer = createRenderer({ json: opts });
  if (opts) {
    renderer.jsonOut(jsonErrorEnvelope(cliErrorFromCode('RUNTIME_ERROR', formatCliError(err))));
  } else {
    renderer.render({ json: null, human: `Error: ${formatCliError(err)}` });
  }
  process.exitCode = exitCodeForCliError(cliErrorFromCode('RUNTIME_ERROR', 'cli failed'));
});
