import { describe, expect, it } from 'vitest';
import { interpolateAny, type RuntimeContext } from '../src/execution/interpolation.ts';

function runtimeContext(): RuntimeContext {
  return {
    configDir: '/tmp/dispatch-test',
    input: {
      resourceId: 123,
      enabled: true,
    },
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
  it('reads environment variables for full-expression and embedded values', () => {
    const prevBaseUrl = process.env.DISPATCH_HTTP_BASE_URL;
    const prevContext = process.env.DISPATCH_HTTP_X_CONTEXT;
    process.env.DISPATCH_HTTP_BASE_URL = 'https://api.example.test';
    process.env.DISPATCH_HTTP_X_CONTEXT = 'example-context';

    try {
      const out = interpolateAny(
        {
          baseUrl: '${env.DISPATCH_HTTP_BASE_URL}',
          title: 'context=${env.DISPATCH_HTTP_X_CONTEXT}',
        },
        runtimeContext(),
      );

      expect(out).toEqual({
        baseUrl: 'https://api.example.test',
        title: 'context=example-context',
      });
    } finally {
      if (prevBaseUrl === undefined) delete process.env.DISPATCH_HTTP_BASE_URL;
      else process.env.DISPATCH_HTTP_BASE_URL = prevBaseUrl;
      if (prevContext === undefined) delete process.env.DISPATCH_HTTP_X_CONTEXT;
      else process.env.DISPATCH_HTTP_X_CONTEXT = prevContext;
    }
  });

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

  it('reads step exports for full-expression and embedded values', () => {
    const out = interpolateAny(
      {
        exported: '${step.sample.exports}',
        id: '${step.sample.exports.generatedId}',
        request: '${step.sample.exports.request}',
        title: 'Event ${step.sample.exports.generatedId}',
      },
      runtimeContext(),
    );

    expect(out).toEqual({
      exported: {
        generatedId: 'id-123',
        request: {
          id: 99,
          tags: ['featured'],
        },
      },
      id: 'id-123',
      request: {
        id: 99,
        tags: ['featured'],
      },
      title: 'Event id-123',
    });
  });

  it('reads whole step responses for full-expression values', () => {
    const out = interpolateAny(
      {
        response: '${step.sample.response}',
      },
      runtimeContext(),
    );

    expect(out).toEqual({
      response: {
        id: 42,
        variants: ['alpha', 'beta', 'gamma'],
        config: {
          count: 1,
        },
      },
    });
  });

  it('reads caller-supplied inputs for full-expression and embedded values', () => {
    const out = interpolateAny(
      {
        resourceId: '${input.resourceId}',
        title: 'enabled=${input.enabled}',
      },
      runtimeContext(),
    );

    expect(out).toEqual({
      resourceId: 123,
      title: 'enabled=true',
    });
  });
});
