import { describe, expect, it } from 'vitest';
import { evaluateConditionGroup } from '../src/execution/conditions.ts';

describe('conditions', () => {
  it('supports ALL mode', () => {
    const out = evaluateConditionGroup({
      mode: 'ALL',
      rules: [
        { path: '$.a', op: 'eq', value: 1 },
        { path: '$.b', op: 'exists' },
      ],
    }, { a: 1, b: true });

    expect(out.matched).toBe(true);
    expect(out.summaries.length).toBe(2);
  });

  it('supports ANY mode', () => {
    const out = evaluateConditionGroup({
      mode: 'ANY',
      rules: [
        { path: '$.a', op: 'eq', value: 2 },
        { path: '$.b', op: 'eq', value: 3 },
        { path: '$.c', op: 'eq', value: 4 },
      ],
    }, { a: 0, b: 3, c: 0 });

    expect(out.matched).toBe(true);
  });

  it('supports every operator', () => {
    const data = {
      str: 'alpha-beta',
      num: 5,
      arr: [1, 2, 3],
      nested: { value: 'x' },
      empty: [],
      nothing: null,
    };

    const out = evaluateConditionGroup({
      mode: 'ALL',
      rules: [
        { path: '$.nested.value', op: 'exists' },
        { path: '$.missing', op: 'not_exists' },
        { path: '$.nested.value', op: 'eq', value: 'x' },
        { path: '$.nested.value', op: 'neq', value: 'y' },
        { path: '$.num', op: 'gt', value: 4 },
        { path: '$.num', op: 'gte', value: 5 },
        { path: '$.num', op: 'lt', value: 6 },
        { path: '$.num', op: 'lte', value: 5 },
        { path: '$.num', op: 'in', value: [4, 5, 6] },
        { path: '$.num', op: 'not_in', value: [1, 2, 3] },
        { path: '$.arr', op: 'contains', value: 2 },
        { path: '$.str', op: 'regex', value: '^alpha' },
      ],
    }, data);

    expect(out.matched).toBe(true);
    expect(out.summaries).toHaveLength(12);
  });

  it('supports nested groups', () => {
    const out = evaluateConditionGroup({
      mode: 'ALL',
      rules: [
        { path: '$.a', op: 'eq', value: 1 },
        {
          mode: 'ANY',
          rules: [
            { path: '$.b', op: 'eq', value: 0 },
            {
              mode: 'ALL',
              rules: [
                { path: '$.c', op: 'eq', value: 3 },
                { path: '$.d', op: 'contains', value: 'z' },
              ],
            },
          ],
        },
      ],
    }, { a: 1, b: 2, c: 3, d: 'xyz' });

    expect(out.matched).toBe(true);
  });

  it('handles null, undefined, and empty arrays in edge cases', () => {
    const out = evaluateConditionGroup({
      mode: 'ALL',
      rules: [
        { path: '$.missing', op: 'not_exists' },
        { path: '$.nothing', op: 'not_exists' },
        { path: '$.empty', op: 'not_exists' },
        { path: '$.text', op: 'contains', value: 'alp' },
      ],
    }, { nothing: null, empty: [], text: 'alpha' });

    expect(out.matched).toBe(true);
  });
});
