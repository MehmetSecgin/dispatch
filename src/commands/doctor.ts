import fs from 'node:fs';
import { Command } from 'commander';
import { RUN_OUTPUT_DIR } from '../data/paths.js';
import { createRenderer, isColorEnabled, paint, uiSymbol } from '../output/renderer.js';
import { SKILL_VERSION } from '../generated/skill-version.js';
import { cliErrorFromCode, exitCodeForCliError, jsonErrorEnvelope } from '../core/errors.js';
import { loadModuleRegistry } from '../modules/index.js';

interface RegisterDoctorDeps {
  cliVersion: string;
}

type DoctorCheck = {
  name: string;
  ok: boolean;
  detail?: string;
};

export function registerDoctorCommand(program: Command, deps: RegisterDoctorDeps): void {
  program
    .command('doctor')
    .description('Run local health checks for public dispatch setup')
    .action(async () => {
      const opts = program.opts();
      const color = isColorEnabled(opts);
      const renderer = createRenderer({ json: !!opts.json, color });
      const checks: DoctorCheck[] = [];

      try {
        const { registry } = await loadModuleRegistry();
        const names =
          registry
            .listModules()
            .map((m) => m.name)
            .join(', ') || 'none';
        checks.push({ name: 'module registry', ok: registry.listModules().length > 0, detail: names });
      } catch (err) {
        checks.push({ name: 'module registry', ok: false, detail: err instanceof Error ? err.message : String(err) });
      }

      try {
        fs.mkdirSync(RUN_OUTPUT_DIR, { recursive: true });
        checks.push({ name: 'run-output writable', ok: true, detail: RUN_OUTPUT_DIR });
      } catch (err) {
        checks.push({
          name: 'run-output writable',
          ok: false,
          detail: err instanceof Error ? err.message : String(err),
        });
      }

      const ok = checks.every((c) => c.ok);
      const out = {
        ok,
        cliVersion: deps.cliVersion,
        skillVersion: SKILL_VERSION,
        checks,
      };
      renderer.render({
        json: ok ? out : jsonErrorEnvelope(cliErrorFromCode('RUNTIME_ERROR', 'doctor checks failed', { result: out })),
        human: [
          ...checks.map((check) => {
            const mark = check.ok ? paint('✓', 'success', color) : paint('✗', 'error', color);
            const detail = check.detail ? ` (${check.detail})` : '';
            return `${mark} ${check.name}${detail}`;
          }),
          paint(
            ok ? `${uiSymbol('success', color)} doctor passed` : `${uiSymbol('error', color)} doctor failed`,
            ok ? 'success' : 'error',
            color,
          ),
        ],
      });
      if (!ok) process.exitCode = exitCodeForCliError(cliErrorFromCode('RUNTIME_ERROR', 'doctor checks failed'));
    });
}
