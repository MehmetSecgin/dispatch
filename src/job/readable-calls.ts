interface ReadableCallEntry {
  idx?: string;
  name?: string;
  method?: string;
  url?: string;
  httpCode?: number | string;
  startedAt?: string;
  endedAt?: string;
  curl?: string;
  request?: unknown;
  response?: unknown;
}

function safePretty(value: unknown): string {
  if (value === undefined) return '<undefined>';
  if (value === null) return 'null';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function renderReadableRequestsResponses(runId: string, calls: ReadableCallEntry[]): string {
  const lines: string[] = [];
  lines.push(`Run ID: ${runId}`);
  lines.push(`Calls: ${calls.length}`);
  lines.push('');

  for (const c of calls) {
    lines.push('============================================================');
    lines.push(`Call: ${c.idx ?? '-'} ${c.name ?? '-'}`);
    lines.push(`HTTP: ${c.method ?? '-'} ${c.url ?? '-'} -> ${c.httpCode ?? '-'}`);
    if (c.startedAt) lines.push(`Started: ${c.startedAt}`);
    if (c.endedAt) lines.push(`Ended:   ${c.endedAt}`);
    if (c.curl) {
      lines.push('');
      lines.push('curl:');
      lines.push(c.curl);
    }
    lines.push('');
    lines.push('Request:');
    lines.push(safePretty(c.request));
    lines.push('');
    lines.push('Response:');
    lines.push(safePretty(c.response));
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}
