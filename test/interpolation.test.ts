import { describe, expect, it } from 'vitest';
import { interpolateAny, type RuntimeContext } from '../src/execution/interpolation.ts';

function runtimeContext(): RuntimeContext {
  return {
    configDir: '/tmp/dispatch-test',
    run: {
      cliVersion: '0.0.1',
      startedAt: '2026-03-07T12:00:00.000Z',
      market: {
        name: '1X2 FullTime',
      },
    },
    steps: {
      market: {
        response: {
          id: 42,
          selections: ['home', 'draw', 'away'],
          config: {
            winners: 1,
          },
        },
        exports: {
          generatedId: 'id-123',
          request: {
            id: 99,
            tags: ['featured'],
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
        payload: '${jsonpath(step:market, $)}',
      },
      runtimeContext(),
    );

    expect(out).toEqual({
      payload: {
        id: 42,
        selections: ['home', 'draw', 'away'],
        config: {
          winners: 1,
        },
      },
    });
  });

  it('still stringifies embedded expressions inside larger strings', () => {
    const out = interpolateAny(
      {
        title: 'Market ${step.market.response.id} for ${run.market.name}',
      },
      runtimeContext(),
    );

    expect(out).toEqual({
      title: 'Market 42 for 1X2 FullTime',
    });
  });

  it('reads step exports for full-expression and embedded values', () => {
    const out = interpolateAny(
      {
        id: '${step.market.exports.generatedId}',
        request: '${step.market.exports.request}',
        title: 'Event ${step.market.exports.generatedId}',
      },
      runtimeContext(),
    );

    expect(out).toEqual({
      id: 'id-123',
      request: {
        id: 99,
        tags: ['featured'],
      },
      title: 'Event id-123',
    });
  });
});
