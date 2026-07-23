import { afterEach, describe, expect, it } from 'vitest';
import { JobCaseSchema } from '../src/core/schema.ts';
import { inspectHttpDependencies } from '../src/job/dependencies.ts';
import { resolveStepHttpConfig } from '../src/job/runner.ts';
import type { RuntimeContext } from '../src/execution/interpolation.ts';

function parseJob(input: unknown) {
  return JobCaseSchema.parse(input);
}

function makeRuntime(): RuntimeContext {
  return {
    configDir: '/tmp/dispatch-test',
    input: {},
    run: { startedAt: '2026-05-18T00:00:00Z' },
    steps: {},
  } as unknown as RuntimeContext;
}

const ENV_KEYS = ['DISPATCH_SECONDARY_BASE_URL', 'DISPATCH_BRAND', 'UNSET_FOR_TEST'];
const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('step-level http override — schema', () => {
  it('accepts a step with its own http baseUrl and headers', () => {
    const job = parseJob({
      schemaVersion: 1,
      jobType: 'cross-host',
      http: { baseUrl: 'http://localhost:8080' },
      scenario: {
        steps: [
          { id: 'publish', action: 'mod-a.publish', payload: {} },
          {
            id: 'assign',
            action: 'mod-b.assign',
            payload: {},
            http: {
              baseUrl: 'https://api-b.example.test',
              defaultHeaders: { 'x-brand': 'brand-b' },
            },
          },
        ],
      },
    });

    expect(job.scenario.steps[1].http?.baseUrl).toBe('https://api-b.example.test');
    expect(job.scenario.steps[1].http?.defaultHeaders?.['x-brand']).toBe('brand-b');
  });
});

describe('inspectHttpDependencies — per-step merge', () => {
  it('passes when job-level provides all required paths and no step overrides', () => {
    const job = parseJob({
      schemaVersion: 1,
      jobType: 'single-host',
      http: {
        baseUrl: 'http://localhost:8080',
        defaultHeaders: { 'x-brand': 'brand-a' },
      },
      dependencies: { http: { required: ['baseUrl', 'defaultHeaders.x-brand'] } },
      scenario: {
        steps: [{ id: 's1', action: 'mod-a.publish', payload: {} }],
      },
    });

    const result = inspectHttpDependencies(job);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('fails when job-level lacks required path and no step overrides', () => {
    const job = parseJob({
      schemaVersion: 1,
      jobType: 'missing-brand',
      http: { baseUrl: 'http://localhost:8080' },
      dependencies: { http: { required: ['defaultHeaders.x-brand'] } },
      scenario: {
        steps: [{ id: 's1', action: 'mod-a.publish', payload: {} }],
      },
    });

    const result = inspectHttpDependencies(job);
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatchObject({
      code: 'MISSING_HTTP_DEPENDENCY',
      httpPath: 'defaultHeaders.x-brand',
    });
    expect(result.issues[0].message).not.toContain('for step');
  });

  it('passes when step-level override supplies the missing required path', () => {
    const job = parseJob({
      schemaVersion: 1,
      jobType: 'step-supplies-baseurl',
      dependencies: { http: { required: ['baseUrl', 'defaultHeaders.x-brand'] } },
      scenario: {
        steps: [
          {
            id: 'assign',
            action: 'mod-b.assign',
            payload: {},
            http: {
              baseUrl: 'https://api-b.example.test',
              defaultHeaders: { 'x-brand': 'brand-b' },
            },
          },
        ],
      },
    });

    const result = inspectHttpDependencies(job);
    expect(result.valid).toBe(true);
  });

  it('keeps job-level header when a step overrides only baseUrl', () => {
    const job = parseJob({
      schemaVersion: 1,
      jobType: 'cross-host-keeps-job-brand',
      http: {
        baseUrl: 'http://localhost:8080',
        defaultHeaders: { 'x-brand': 'brand-a' },
      },
      dependencies: { http: { required: ['baseUrl', 'defaultHeaders.x-brand'] } },
      scenario: {
        steps: [
          { id: 'publish', action: 'mod-a.publish', payload: {} },
          {
            id: 'assign',
            action: 'mod-b.assign',
            payload: {},
            http: { baseUrl: 'https://api-b.example.test' },
          },
        ],
      },
    });

    const result = inspectHttpDependencies(job);
    // Job-level x-brand survives the shallow merge for the second step.
    expect(result.valid).toBe(true);
  });

  it('keeps job-level header when a step provides unrelated defaultHeaders', () => {
    const job = parseJob({
      schemaVersion: 1,
      jobType: 'cross-host-overrides-headers-without-brand',
      http: {
        baseUrl: 'http://localhost:8080',
        defaultHeaders: { 'x-brand': 'brand-a' },
      },
      dependencies: { http: { required: ['defaultHeaders.x-brand'] } },
      scenario: {
        steps: [
          {
            id: 'assign',
            action: 'mod-b.assign',
            payload: {},
            http: {
              baseUrl: 'https://api-b.example.test',
              defaultHeaders: { 'x-other': 'value' },
            },
          },
        ],
      },
    });

    const result = inspectHttpDependencies(job);
    // Shallow merge keeps unrelated job-level keys.
    expect(result.valid).toBe(true);
  });

  it('flags a step whose merged http is missing a required path with step id in the message', () => {
    const job = parseJob({
      schemaVersion: 1,
      jobType: 'step-missing-required-path',
      // Job has no baseUrl; only the first step sets it.
      dependencies: { http: { required: ['baseUrl'] } },
      scenario: {
        steps: [
          {
            id: 'publish',
            action: 'mod-a.publish',
            payload: {},
            http: { baseUrl: 'http://localhost:8080' },
          },
          { id: 'follow-up', action: 'flow.sleep', payload: { duration: '1s' } },
        ],
      },
    });

    const result = inspectHttpDependencies(job);
    expect(result.valid).toBe(false);
    const missing = result.issues.find((i) => i.httpPath === 'baseUrl');
    expect(missing?.message).toContain('for step follow-up');
  });
});

describe('resolveStepHttpConfig — interpolation', () => {
  it('returns undefined when no step http', () => {
    expect(resolveStepHttpConfig(undefined, makeRuntime(), 's1')).toBeUndefined();
  });

  it('resolves env interpolation in baseUrl', () => {
    process.env.DISPATCH_SECONDARY_BASE_URL = 'https://example.test';
    const out = resolveStepHttpConfig(
      { baseUrl: '${env.DISPATCH_SECONDARY_BASE_URL}' },
      makeRuntime(),
      's1',
    );
    expect(out?.baseUrl).toBe('https://example.test');
  });

  it('throws with step id when baseUrl resolves to empty', () => {
    delete process.env.UNSET_FOR_TEST;
    expect(() =>
      resolveStepHttpConfig({ baseUrl: '${env.UNSET_FOR_TEST}' }, makeRuntime(), 'assign'),
    ).toThrow(/Step assign http\.baseUrl/);
  });

  it('resolves env interpolation in defaultHeaders values', () => {
    process.env.DISPATCH_BRAND = 'brand-a';
    const out = resolveStepHttpConfig(
      { defaultHeaders: { 'x-brand': '${env.DISPATCH_BRAND}' } },
      makeRuntime(),
      's1',
    );
    expect(out?.defaultHeaders?.['x-brand']).toBe('brand-a');
  });
});
