export interface NextAction {
  command: string;
  description: string;
}

interface NextActionTemplate {
  command: string;
  description: string;
}

interface NextActionContext {
  runId?: string;
  stepIndex?: number;
  batchId?: string;
  firstFailedRunId?: string;
}

function interpolate(template: string, context: NextActionContext): string {
  return template.replace(/\{([a-zA-Z0-9]+)\}/g, (_match, key: keyof NextActionContext) => {
    const value = context[key];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing next-action token: ${String(key)}`);
    }
    return String(value);
  });
}

function renderNextActions(templates: NextActionTemplate[], context: NextActionContext): NextAction[] {
  const seen = new Set<string>();
  const out: NextAction[] = [];

  for (const template of templates) {
    if (seen.has(template.command)) continue;
    seen.add(template.command);
    try {
      out.push({
        command: interpolate(template.command, context),
        description: interpolate(template.description, context),
      });
    } catch {
      continue;
    }
  }

  return out;
}

export function nextActionsForJobRun(input: {
  status: 'SUCCESS' | 'FAILED';
  runId: string;
  failedStepIndex?: number | null;
}): NextAction[] {
  if (input.status === 'SUCCESS') {
    return renderNextActions(
      [
        {
          command: 'dispatch job assert --run-id {runId}',
          description: 'verify outcomes',
        },
      ],
      { runId: input.runId },
    );
  }

  return renderNextActions(
    [
      {
        command: 'dispatch job inspect --run-id {runId} --step {stepIndex}',
        description: 'see what failed at step {stepIndex}',
      },
      {
        command: 'dispatch job readable --run-id {runId}',
        description: 'full request/response trace',
      },
      {
        command: 'dispatch job replay --run-id {runId}',
        description: 'retry with same inputs',
      },
    ],
    {
      runId: input.runId,
      stepIndex: input.failedStepIndex ?? undefined,
    },
  );
}

export function nextActionsForJobAssert(input: { overall: 'PASS' | 'FAIL'; runId: string }): NextAction[] {
  if (input.overall === 'PASS') return [];

  return renderNextActions(
    [
      {
        command: 'dispatch job inspect --run-id {runId}',
        description: 'see what failed',
      },
      {
        command: 'dispatch job dump --run-id {runId}',
        description: 'export full artifact',
      },
    ],
    { runId: input.runId },
  );
}

export function nextActionsForRunMany(input: {
  overall: 'PASS' | 'FAIL';
  batchId: string;
  firstFailedRunId?: string;
}): NextAction[] {
  if (input.overall === 'PASS') {
    return renderNextActions(
      [
        {
          command: 'dispatch job batch-inspect --batch-id {batchId}',
          description: 'review batch results',
        },
      ],
      { batchId: input.batchId },
    );
  }

  return renderNextActions(
    [
      {
        command: 'dispatch job batch-inspect --batch-id {batchId}',
        description: 'review batch results',
      },
      {
        command: 'dispatch job replay --run-id {firstFailedRunId}',
        description: 'retry first failure',
      },
    ],
    {
      batchId: input.batchId,
      firstFailedRunId: input.firstFailedRunId,
    },
  );
}
