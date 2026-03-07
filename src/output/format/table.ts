type TableCell = string | number;

type TableOptions = {
  flexColumn?: number;
  minFlexWidth?: number;
  dropFlexIfNarrow?: boolean;
};

export type GroupedTableGroup = {
  header: [string, string];
  rows: Array<[string, string]>;
};

const ANSI_RE = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function terminalWidth(): number {
  return process.stdout.columns ?? 80;
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

function visibleWidth(text: string): number {
  return stripAnsi(text).length;
}

function truncateText(text: string, maxWidth: number): string {
  const clean = stripAnsi(String(text));
  if (maxWidth <= 0) return '';
  if (clean.length <= maxWidth) return clean;
  if (maxWidth === 1) return '…';
  return `${clean.slice(0, maxWidth - 1)}…`;
}

function padCell(text: string, width: number): string {
  const clean = truncateText(text, width);
  return clean.padEnd(width, ' ');
}

function inferTableOptions(headers: string[]): Required<TableOptions> {
  const descriptionIndex = headers.findIndex(h => h.toLowerCase() === 'description');
  if (descriptionIndex >= 0) {
    return { flexColumn: descriptionIndex, minFlexWidth: 20, dropFlexIfNarrow: true };
  }
  const errorIndex = headers.findIndex(h => h.toLowerCase() === 'error');
  if (errorIndex >= 0) {
    return { flexColumn: errorIndex, minFlexWidth: 12, dropFlexIfNarrow: false };
  }
  return { flexColumn: Math.max(0, headers.length - 1), minFlexWidth: 1, dropFlexIfNarrow: false };
}

function fitTable(headers: string[], rows: string[][], width: number, options?: TableOptions): { headers: string[]; rows: string[][]; widths: number[] } {
  const merged = { ...inferTableOptions(headers), ...(options ?? {}) };
  let activeHeaders = [...headers];
  let activeRows = rows.map(row => [...row]);
  let flexColumn = merged.flexColumn;

  const recompute = () => activeHeaders.map((header, index) =>
    Math.max(
      visibleWidth(header),
      ...activeRows.map(row => visibleWidth(row[index] ?? '')),
    ),
  );

  const totalWidth = (colWidths: number[]) => colWidths.reduce((sum, value) => sum + value, 0) + (3 * colWidths.length) + 1;

  let widths = recompute();

  if (flexColumn >= 0 && totalWidth(widths) > width) {
    const fixedWidth = widths.reduce((sum, value, index) => index === flexColumn ? sum : sum + value, 0);
    const availableForFlex = width - ((3 * widths.length) + 1) - fixedWidth;
    if (availableForFlex < merged.minFlexWidth && merged.dropFlexIfNarrow) {
      activeHeaders = activeHeaders.filter((_, index) => index !== flexColumn);
      activeRows = activeRows.map(row => row.filter((_, index) => index !== flexColumn));
      flexColumn = -1;
      widths = recompute();
    } else if (availableForFlex > 0) {
      widths[flexColumn] = Math.min(widths[flexColumn], availableForFlex);
    }
  }

  while (totalWidth(widths) > width) {
    let widestIndex = 0;
    for (let i = 1; i < widths.length; i += 1) {
      if (widths[i] > widths[widestIndex]) widestIndex = i;
    }
    if (widths[widestIndex] <= 1) break;
    widths[widestIndex] -= 1;
  }

  return { headers: activeHeaders, rows: activeRows, widths };
}

export function renderTableString(headers: string[], rows: Array<Array<TableCell>>, options?: TableOptions): string {
  const normalizedRows = rows.map(row => row.map(cell => String(cell ?? '')));
  const fitted = fitTable(headers, normalizedRows, terminalWidth(), options);
  const drawRow = (cells: string[]) => `│ ${cells.map((cell, index) => padCell(cell, fitted.widths[index])).join(' │ ')} │`;
  const top = `┌${fitted.widths.map(width => '─'.repeat(width + 2)).join('┬')}┐`;
  const mid = `├${fitted.widths.map(width => '─'.repeat(width + 2)).join('┼')}┤`;
  const bottom = `└${fitted.widths.map(width => '─'.repeat(width + 2)).join('┴')}┘`;
  return [
    top,
    drawRow(fitted.headers),
    mid,
    ...fitted.rows.map(drawRow),
    bottom,
  ].join('\n');
}

export function renderGroupedTableString(
  headers: [string, string],
  groups: GroupedTableGroup[],
  opts?: { minFlexWidth?: number },
): string {
  const width = terminalWidth();
  const leftCells = groups.flatMap(group => [group.header[0], ...group.rows.map(row => row[0])]);
  const naturalLeftWidth = Math.max(headers[0].length, ...leftCells.map(cell => cell.length));
  const minFlexWidth = opts?.minFlexWidth ?? 20;
  const borderWidth = 7;
  const maxLeftWidth = Math.max(1, width - borderWidth - minFlexWidth);
  const leftWidth = Math.min(naturalLeftWidth, maxLeftWidth);
  const rightWidth = width - borderWidth - leftWidth;
  const includeRight = rightWidth >= minFlexWidth;
  const activeHeaders = includeRight ? [...headers] : [headers[0]];
  const widths = includeRight ? [leftWidth, rightWidth] : [Math.max(1, width - 4)];
  const drawRow = (cells: string[]) => `│ ${cells.map((cell, index) => padCell(cell, widths[index])).join(' │ ')} │`;
  const drawRule = (left: string, middle: string, right: string) => `${left}${widths.map(value => '─'.repeat(value + 2)).join(middle)}${right}`;
  const lines = [
    drawRule('┌', '┬', '┐'),
    drawRow(activeHeaders),
    drawRule('├', '┼', '┤'),
  ];

  groups.forEach((group, groupIndex) => {
    const rows = [
      includeRight ? [group.header[0], group.header[1]] : [group.header[0]],
      ...group.rows.map(row => (includeRight ? [row[0], row[1]] : [row[0]])),
    ];
    for (const row of rows) lines.push(drawRow(row));
    if (groupIndex < groups.length - 1) lines.push(drawRule('├', '┼', '┤'));
  });

  lines.push(drawRule('└', '┴', '┘'));
  return lines.join('\n');
}
