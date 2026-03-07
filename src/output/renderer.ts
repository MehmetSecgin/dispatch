import { cleanJson } from './json.js';
import type { JsonValue } from '../core/json.js';
import {
  formatBatchInspectHumanResult,
  formatJobAssertHumanResult,
  formatNextActionsHuman,
} from './format/job.js';
import {
  isColorEnabled,
  paint,
  parseRunId,
  renderStatusBox,
  runIdToIso,
  shortenHomePath,
  uiSymbol,
  userPathDisplay,
} from './format/symbols.js';
import type { GroupedTableGroup } from './format/table.js';
import { renderGroupedTableString, renderTableString } from './format/table.js';

type HumanRenderable = string | Array<string | null | undefined> | null | undefined;

function normalizeHuman(renderable: HumanRenderable): string[] {
  if (renderable === null || renderable === undefined) return [];
  if (typeof renderable === 'string') return renderable.split('\n');
  return renderable
    .filter((line): line is string => line !== null && line !== undefined)
    .flatMap((line) => line.split('\n'));
}

export class Renderer {
  readonly json: boolean;
  readonly color: boolean;

  constructor(opts: { json?: boolean; color?: boolean }) {
    this.json = !!opts.json;
    this.color = !!opts.color;
  }

  line(text = ''): void {
    // eslint-disable-next-line no-console
    console.log(text);
  }

  stderr(text: string): void {
    process.stderr.write(text);
  }

  stdout(text: string): void {
    process.stdout.write(text);
  }

  jsonOut(data: unknown): void {
    this.line(JSON.stringify(cleanJson(data) ?? {}, null, 2));
  }

  objectLines(data: Record<string, JsonValue>): void {
    for (const [k, v] of Object.entries(data)) {
      this.line(`${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
  }

  render(payload: { json: unknown; human: HumanRenderable | (() => HumanRenderable) }): void {
    if (this.json) {
      this.jsonOut(payload.json);
      return;
    }
    const human = typeof payload.human === 'function' ? payload.human() : payload.human;
    for (const line of normalizeHuman(human)) this.line(line);
  }

  table(
    headers: string[],
    rows: Array<Array<string | number>>,
    options?: { flexColumn?: number; minFlexWidth?: number; dropFlexIfNarrow?: boolean },
  ): void {
    this.line(renderTableString(headers, rows, options));
  }

  groupedTable(headers: [string, string], groups: GroupedTableGroup[], opts?: { minFlexWidth?: number }): void {
    this.line(renderGroupedTableString(headers, groups, opts));
  }

  progress(text: string): void {
    this.stderr(text);
  }

  clearProgress(): void {
    this.stderr('\r\x1B[2K');
  }
}

export function createRenderer(opts: { json?: boolean; color?: boolean }): Renderer {
  return new Renderer(opts);
}

export function formatCliError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.startsWith('flow.poll timeout action=')) {
    return `${msg}\nHint: run 'dispatch job inspect --run-id latest' and 'dispatch job readable --run-id latest' to diagnose polling conditions and responses.`;
  }
  const httpFail = msg.match(/^([a-z0-9-]+\.[a-z0-9-]+) failed with HTTP (\d+):/i);
  if (httpFail) {
    const action = httpFail[1];
    const code = httpFail[2];
    return `${msg}\nHint: check payload shape in docs/modules and validate input for '${action}' (HTTP ${code}).`;
  }
  return msg;
}

export {
  cleanJson,
  formatBatchInspectHumanResult,
  formatJobAssertHumanResult,
  formatNextActionsHuman,
  isColorEnabled,
  paint,
  parseRunId,
  renderGroupedTableString,
  renderStatusBox,
  renderTableString,
  runIdToIso,
  shortenHomePath,
  uiSymbol,
  userPathDisplay,
};

export type { GroupedTableGroup };
