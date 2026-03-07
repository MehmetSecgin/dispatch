import { describe, expect, it } from 'vitest';
import { nextActionsForJobAssert, nextActionsForJobRun, nextActionsForRunMany } from '../src/job/next-actions.ts';

describe('next actions', () => {
  it('returns the success CTA for job run', () => {
    expect(nextActionsForJobRun({
      status: 'SUCCESS',
      runId: 'run-123',
    })).toEqual([
      {
        command: 'dispatch job assert --run-id run-123',
        description: 'verify outcomes',
      },
    ]);
  });

  it('returns failure CTAs for job run with interpolated step index', () => {
    expect(nextActionsForJobRun({
      status: 'FAILED',
      runId: 'run-456',
      failedStepIndex: 3,
    })).toEqual([
      {
        command: 'dispatch job inspect --run-id run-456 --step 3',
        description: 'see what failed at step 3',
      },
      {
        command: 'dispatch job readable --run-id run-456',
        description: 'full request/response trace',
      },
      {
        command: 'dispatch job replay --run-id run-456',
        description: 'retry with same inputs',
      },
    ]);
  });

  it('returns an empty array for passing assertions', () => {
    expect(nextActionsForJobAssert({
      overall: 'PASS',
      runId: 'run-789',
    })).toEqual([]);
  });

  it('returns failure CTAs for job assertions', () => {
    expect(nextActionsForJobAssert({
      overall: 'FAIL',
      runId: 'run-789',
    })).toEqual([
      {
        command: 'dispatch job inspect --run-id run-789',
        description: 'see what failed',
      },
      {
        command: 'dispatch job dump --run-id run-789',
        description: 'export full artifact',
      },
    ]);
  });

  it('returns batch inspect only when run-many passes', () => {
    expect(nextActionsForRunMany({
      overall: 'PASS',
      batchId: 'batch-123',
    })).toEqual([
      {
        command: 'dispatch job batch-inspect --batch-id batch-123',
        description: 'review batch results',
      },
    ]);
  });

  it('skips the replay CTA when the first failed run id is unavailable', () => {
    expect(nextActionsForRunMany({
      overall: 'FAIL',
      batchId: 'batch-123',
    })).toEqual([
      {
        command: 'dispatch job batch-inspect --batch-id batch-123',
        description: 'review batch results',
      },
    ]);
  });

  it('returns both batch CTAs when a failed run id is available', () => {
    expect(nextActionsForRunMany({
      overall: 'FAIL',
      batchId: 'batch-123',
      firstFailedRunId: 'run-fail-1',
    })).toEqual([
      {
        command: 'dispatch job batch-inspect --batch-id batch-123',
        description: 'review batch results',
      },
      {
        command: 'dispatch job replay --run-id run-fail-1',
        description: 'retry first failure',
      },
    ]);
  });
});
