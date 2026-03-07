import { afterEach, describe, expect, it } from 'vitest';
import { renderTableString } from '../src/output/format/table.ts';

const originalColumns = process.stdout.columns;

function setColumns(width: number | undefined) {
  Object.defineProperty(process.stdout, 'columns', {
    configurable: true,
    value: width,
  });
}

describe('renderer table sizing', () => {
  afterEach(() => {
    setColumns(originalColumns);
  });

  it('truncates the description column to fit the terminal width', () => {
    setColumns(80);
    const table = renderTableString(
      ['Action', 'Source', 'Description'],
      [[
        'flow.poll',
        'flow@1.0.0 (builtin)',
        'Call another action repeatedly until JSONPath conditions match or timeout/attempt limit is reached.',
      ]],
      { flexColumn: 2, minFlexWidth: 20, dropFlexIfNarrow: true },
    );

    expect(table).toContain('Call another action repeatedly until JSO…');
    for (const line of table.split('\n')) expect(line.length).toBeLessThanOrEqual(80);
  });

  it('drops the description column when the terminal is too narrow', () => {
    setColumns(40);
    const table = renderTableString(
      ['Action', 'Source', 'Description'],
      [['flow.poll', 'flow@1.0.0 (builtin)', 'Long description here']],
      { flexColumn: 2, minFlexWidth: 20, dropFlexIfNarrow: true },
    );

    expect(table).not.toContain('Description');
    for (const line of table.split('\n')) expect(line.length).toBeLessThanOrEqual(40);
  });
});
