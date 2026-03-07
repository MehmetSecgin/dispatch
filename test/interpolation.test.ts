import { describe, expect, it } from 'vitest';
import { interpolateAny, type RuntimeContext } from '../src/execution/interpolation.ts';

function runtimeContext(): RuntimeContext {
  return {
    configDir: '/tmp/dispatch-test',
    run: {
      cliVersion: '0.0.1',
      startedAt: '2026-03-07T12:00:00.000Z',
      sample: {
        name: 'example-config',
      },
    },
    steps: {
      sample: {
        response: {
          id: 42,
          variants: ['alpha', 'beta', 'gamma'],
          config: {
            count: 1,
          },
        },
      },
    },
  };
}

describe('interpolateAny', () => {
  it('preserves raw objects for full-expression values', () => {
    const out = interpolateAny(
      {
        payload: '${jsonpath(step:sample, $)}',
      },
      runtimeContext(),
    );

    expect(out).toEqual({
      payload: {
        id: 42,
        variants: ['alpha', 'beta', 'gamma'],
        config: {
          count: 1,
        },
      },
    });
  });

  it('still stringifies embedded expressions inside larger strings', () => {
    const out = interpolateAny(
      {
        title: 'Sample ${step.sample.response.id} for ${run.sample.name}',
      },
      runtimeContext(),
    );

    expect(out).toEqual({
      title: 'Sample 42 for example-config',
    });
  });
});
