import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { coerceInputsFromSchema, resolveEffectiveType } from '../src/execution/schema-coerce.ts';

describe('schema coercion', () => {
  it('coerces simple top-level scalar fields', () => {
    const schema = z.object({
      name: z.string(),
      count: z.number(),
      enabled: z.boolean(),
    });

    const result = coerceInputsFromSchema(
      {
        name: 'demo',
        count: '42',
        enabled: 'true',
      },
      schema,
    );

    expect(result.issues).toEqual([]);
    expect(result.payload).toEqual({
      name: 'demo',
      count: 42,
      enabled: true,
    });
  });

  it('coerces enum, optional, array, and object fields', () => {
    const schema = z.object({
      status: z.enum(['OPEN', 'CLOSED']),
      note: z.string().optional(),
      items: z.array(z.object({ id: z.number() })),
      config: z.object({ retry: z.boolean() }),
    });

    const result = coerceInputsFromSchema(
      {
        status: 'OPEN',
        note: 'hello',
        items: '[{"id":1}]',
        config: '{"retry":true}',
      },
      schema,
    );

    expect(result.issues).toEqual([]);
    expect(result.payload).toEqual({
      status: 'OPEN',
      note: 'hello',
      items: [{ id: 1 }],
      config: { retry: true },
    });
  });

  it('passes unknown keys through with JSON.parse fallback', () => {
    const schema = z.object({
      known: z.string(),
    });

    const result = coerceInputsFromSchema(
      {
        known: 'value',
        extra: '{"x":1}',
      },
      schema,
    );

    expect(result.issues).toEqual([]);
    expect(result.payload).toEqual({
      known: 'value',
      extra: { x: 1 },
    });
  });

  it('reports coercion failures without stopping at the first issue', () => {
    const schema = z.object({
      count: z.number(),
      enabled: z.boolean(),
      config: z.object({ retry: z.boolean() }),
      whole: z.number().int(),
    });

    const result = coerceInputsFromSchema(
      {
        count: 'abc',
        enabled: 'yes',
        config: 'nope',
        whole: '1.5',
      },
      schema,
    );

    expect(result.payload).toEqual({});
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'inputs.count' }),
        expect.objectContaining({ path: 'inputs.enabled' }),
        expect.objectContaining({ path: 'inputs.config' }),
        expect.objectContaining({ path: 'inputs.whole' }),
      ]),
    );
  });
});

describe('resolveEffectiveType', () => {
  it('handles direct type nodes', () => {
    expect(resolveEffectiveType({ type: 'string' })).toBe('string');
  });

  it('infers enums', () => {
    expect(resolveEffectiveType({ enum: ['A', 'B'] })).toBe('string');
  });

  it('unwraps optional anyOf encodings when present', () => {
    expect(resolveEffectiveType({ anyOf: [{ type: 'string' }, { not: {} }] })).toBe('string');
  });

  it('returns unknown for ambiguous unions', () => {
    expect(resolveEffectiveType({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toBe('unknown');
  });

  it('returns unknown when no type information is available', () => {
    expect(resolveEffectiveType({})).toBe('unknown');
  });
});
