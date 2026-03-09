import { describe, expect, it } from 'vitest';
import { JobCaseSchema } from '../src/core/schema.ts';
import { validateJobCase } from '../src/job/validator.ts';
import { loadModuleRegistry } from '../src/modules/index.ts';

function parseJob(input: unknown) {
  return JobCaseSchema.parse(input);
}

describe('validateJobCase (flow-only)', () => {
  it('passes a valid minimal sleep case', () => {
    const job = parseJob({
      schemaVersion: 1,
      jobType: 'valid-sleep',
      scenario: {
        steps: [{ id: 's1', action: 'flow.sleep', payload: { duration: '1s' } }],
      },
    });

    const result = validateJobCase(job);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('fails duplicate step ids', () => {
    const job = parseJob({
      schemaVersion: 1,
      jobType: 'dup-id',
      scenario: {
        steps: [
          { id: 'same', action: 'flow.sleep', payload: { duration: '1s' } },
          { id: 'same', action: 'flow.sleep', payload: { duration: '2s' } },
        ],
      },
    });

    const result = validateJobCase(job);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.code === 'DUPLICATE_STEP_ID')).toBe(true);
  });

  it('fails unknown step reference', () => {
    const job = parseJob({
      schemaVersion: 1,
      jobType: 'unknown-ref',
      scenario: {
        steps: [
          {
            id: 's1',
            action: 'flow.sleep',
            payload: { duration: '${step.missing.response.duration}' },
          },
        ],
      },
    });

    const result = validateJobCase(job);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.code === 'UNKNOWN_STEP_REFERENCE')).toBe(true);
  });

  it('accepts backward exports references and rejects forward ones', () => {
    const okJob = parseJob({
      schemaVersion: 1,
      jobType: 'exports-backward-ref',
      scenario: {
        steps: [
          { id: 'publish', action: 'flow.sleep', payload: { duration: '1s' } },
          { id: 'use', action: 'flow.sleep', payload: { duration: '${step.publish.exports.generatedId}' } },
        ],
      },
    });

    const badJob = parseJob({
      schemaVersion: 1,
      jobType: 'exports-forward-ref',
      scenario: {
        steps: [
          { id: 'use', action: 'flow.sleep', payload: { duration: '${step.publish.exports.generatedId}' } },
          { id: 'publish', action: 'flow.sleep', payload: { duration: '1s' } },
        ],
      },
    });

    expect(validateJobCase(okJob).issues.some(i => i.code === 'UNKNOWN_STEP_REFERENCE' || i.code === 'FORWARD_STEP_REFERENCE')).toBe(false);
    expect(validateJobCase(badJob).issues.some(i => i.code === 'FORWARD_STEP_REFERENCE')).toBe(true);
  });

  it('rejects invalid capture mappings', () => {
    const job = parseJob({
      schemaVersion: 1,
      jobType: 'invalid-capture',
      scenario: {
        steps: [
          {
            id: 'publish',
            action: 'flow.sleep',
            payload: { duration: '1s' },
            capture: {
              stableId: 'response.id',
              'bad..key': 'exports.generatedId',
            },
          },
        ],
      },
    });

    const result = validateJobCase(job);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.code === 'INVALID_CAPTURE' && i.message.includes("must start with 'exports.'"))).toBe(true);
    expect(result.issues.some(i => i.code === 'INVALID_CAPTURE' && i.message.includes('non-empty dot segments'))).toBe(true);
  });

  it('fails invalid flow.poll target and jsonpath', async () => {
    const job = parseJob({
      schemaVersion: 1,
      jobType: 'bad-flow-poll',
      scenario: {
        steps: [
          {
            id: 's1',
            action: 'flow.poll',
            payload: {
              action: 'missing.action',
              conditions: {
                mode: 'ALL',
                rules: [{ path: '$[', op: 'exists' }],
              },
              store: { resourceId: '$[' },
            },
          },
        ],
      },
    });

    const { registry } = await loadModuleRegistry();
    const result = validateJobCase(job, registry);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.code === 'FLOW_POLL_VALIDATION_ERROR')).toBe(true);
  });

  it('reports schema validation errors through registry', async () => {
    const job = parseJob({
      schemaVersion: 1,
      jobType: 'bad-sleep-payload',
      scenario: {
        steps: [{ id: 's1', action: 'flow.sleep', payload: {} }],
      },
    });

    const { registry } = await loadModuleRegistry();
    const result = validateJobCase(job, registry);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.code === 'MODULE_VALIDATION_ERROR')).toBe(true);
  });

  it('rejects memory.store in case jobs', () => {
    const job = parseJob({
      schemaVersion: 1,
      jobType: 'bad-case-memory-store',
      scenario: {
        steps: [{ id: 's1', action: 'memory.store', payload: { namespace: 'demo', key: 'x', value: 1 } }],
      },
    });

    const result = validateJobCase(job, undefined, {}, { jobKind: 'case' });
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.code === 'DISALLOWED_MEMORY_MUTATION')).toBe(true);
  });

  it('allows memory.store in seed jobs', () => {
    const job = parseJob({
      schemaVersion: 1,
      jobType: 'good-seed-memory-store',
      scenario: {
        steps: [{ id: 's1', action: 'memory.store', payload: { namespace: 'demo', key: 'x', value: 1 } }],
      },
    });

    const result = validateJobCase(job, undefined, {}, { jobKind: 'seed' });
    expect(result.valid).toBe(true);
  });
});
