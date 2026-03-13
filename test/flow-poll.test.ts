import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ModuleDefinition } from '../src/modules/internal-types.ts';
import { ModuleRegistry } from '../src/modules/registry.ts';
import { evaluateConditionGroup } from '../src/execution/conditions.ts';
import { createFlowModule } from '../src/modules/builtin/flow/index.ts';

function setup(targetHandler: (payload: any) => Promise<any> | any) {
  const registry = new ModuleRegistry();
  registry.register(createFlowModule('builtin:flow'));

  const probeModule: ModuleDefinition = {
    name: 'probe',
    version: '1.0.0',
    layer: 'builtin',
    sourcePath: 'builtin:probe',
    actions: {
      get: {
        description: 'test probe action',
        schema: z.any(),
        handler: async (_ctx, payload) => ({ response: await targetHandler(payload) }),
      },
    },
  };
  registry.register(probeModule);

  const poll = registry.resolve('flow.poll');
  if (!poll) throw new Error('missing flow.poll');

  const runtime: any = { configDir: '/tmp/test-dispatch', run: {}, steps: {} };
  const progressLogs: string[] = [];
  const ctx: any = {
    http: {},
    artifacts: { appendActivity: () => {} },
    runtime,
    step: { id: 'waitMapped', action: 'flow.poll', payload: {} },
    resolve: (k: string) => registry.resolve(k),
    progress: (message: string) => progressLogs.push(message),
  };

  return { poll, ctx, runtime, progressLogs };
}

describe('flow.poll', () => {
  it('succeeds when condition matches on first call', async () => {
    const { poll, ctx, runtime } = setup(() => ({ resource: { id: 11, groupId: 22 } }));
    const result = await poll.definition.handler(ctx, {
      action: 'probe.get',
      payload: {},
      conditions: { mode: 'ALL', rules: [{ path: '$.resource.id', op: 'exists' }] },
      store: { resourceId: '$.resource.id', groupId: '$.resource.groupId' },
    });
    expect(result.response?.matched).toBe(true);
    expect(result.response?.attempts).toBe(1);
    expect(runtime.run.resourceId).toBe(11);
    expect(runtime.run.groupId).toBe(22);
  });

  it('fails immediately on target error when continueOnActionError=false', async () => {
    const { poll, ctx } = setup(() => {
      throw new Error('boom');
    });

    await expect(poll.definition.handler(ctx, {
      action: 'probe.get',
      payload: {},
      continueOnActionError: false,
      conditions: { mode: 'ALL', rules: [{ path: '$.ok', op: 'exists' }] },
    })).rejects.toThrow(/failed on attempt 1: boom/);
  });

  it('respects minSuccessAttempts gate before declaring match', async () => {
    vi.useFakeTimers();
    const { poll, ctx } = setup(() => ({ ok: true }));
    const pending = poll.definition.handler(ctx, {
      action: 'probe.get',
      payload: {},
      intervalMs: 250,
      maxAttempts: 5,
      minSuccessAttempts: 3,
      maxDurationMs: 5000,
      conditions: { mode: 'ALL', rules: [{ path: '$.ok', op: 'eq', value: true }] },
    });

    await vi.runAllTimersAsync();
    const result = await pending;
    vi.useRealTimers();

    expect(result.response?.matched).toBe(true);
    expect(result.response?.attempts).toBe(3);
  });

  it('supports condition groups and comparators', () => {
    const response = { a: 5, b: 'alpha', arr: [1, 2, 3], nested: { k: 'value' } };
    const out = evaluateConditionGroup({
      mode: 'ALL',
      rules: [
        { path: '$.a', op: 'gte', value: 5 },
        {
          mode: 'ANY',
          rules: [
            { path: '$.b', op: 'regex', value: '^alp' },
            { path: '$.arr', op: 'contains', value: 9 },
          ],
        },
        { path: '$.a', op: 'in', value: [4, 5, 6] },
        { path: '$.nested.k', op: 'eq', value: 'value' },
      ],
    }, response);

    expect(out.matched).toBe(true);
    expect(out.summaries.length).toBeGreaterThan(0);
  });
});
