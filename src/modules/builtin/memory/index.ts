import { z } from 'zod';
import { pickJsonPath } from '../../../execution/conditions.js';
import { ModuleDefinition } from '../../internal-types.js';
import { defineAction, defineModule } from '../../types.js';
import { ForgetSchema, ListSchema, RecallManySchema, RecallSchema, StoreManySchema, StoreSchema } from './schemas.js';
import {
  clearMemoryNamespace,
  forgetMemoryValue,
  listMemoryByPrefix,
  listMemoryNamespaces,
  readMemoryNamespace,
  recallMemoryValue,
  recallMemoryValues,
  storeMemoryValue,
  storeMemoryValues,
} from './store.js';

const MemoryRecallResultSchema = z.object({
  found: z.boolean(),
  namespace: z.string(),
  key: z.string(),
  value: z.unknown(),
});

const MemoryBatchStoreResultSchema = z.object({
  stored: z.literal(true),
  namespace: z.string(),
  count: z.number().int().nonnegative(),
  keys: z.array(z.string()),
});

const MemoryRecallManyResultSchema = z.object({
  namespace: z.string(),
  results: z.array(
    z.object({
      key: z.string(),
      found: z.boolean(),
      value: z.unknown(),
    }),
  ),
  foundCount: z.number().int().nonnegative(),
  missingKeys: z.array(z.string()),
});

function appendKeyPrefix(prefix: string | undefined, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

function resolveStoreManyEntries(payload: z.infer<typeof StoreManySchema>): Array<{ key: string; value: unknown }> {
  const entries = Array.isArray(payload.source)
    ? payload.source.map((value, idx) => ({
        sourceLabel: `source[${idx}]`,
        selectorTarget: value,
      }))
    : Object.entries(payload.source).map(([key, value]) => ({
        sourceLabel: `source.${key}`,
        selectorTarget: { key, value },
      }));

  const resolved = entries.map(({ sourceLabel, selectorTarget }) => {
    const rawKey = pickJsonPath(payload.keyJsonPath, selectorTarget);
    if (typeof rawKey !== 'string' || rawKey.trim().length === 0) {
      throw new Error(`memory.store-many ${sourceLabel} produced invalid key`);
    }
    return {
      key: appendKeyPrefix(payload.keyPrefix, rawKey.trim()),
      value: pickJsonPath(payload.valueJsonPath, selectorTarget),
    };
  });

  const seen = new Set<string>();
  for (const entry of resolved) {
    if (seen.has(entry.key)) throw new Error(`memory.store-many produced duplicate key '${entry.key}'`);
    seen.add(entry.key);
  }
  return resolved;
}

export function createMemoryModule(sourcePath: string): ModuleDefinition {
  const moduleDef = defineModule({
    name: 'memory',
    version: '1.0.0',
    actions: {
      store: defineAction({
        description: 'Store a value by key in persistent namespaced memory.',
        schema: StoreSchema,
        handler: async (ctx, payload) => {
          storeMemoryValue(ctx.runtime.configDir, payload.namespace, payload.key, payload.value);
          return {
            response: {
              stored: true,
              namespace: payload.namespace,
              key: payload.key,
              value: payload.value,
            },
            detail: `stored ${payload.namespace}.${payload.key}`,
          };
        },
      }),
      'store-many': defineAction({
        description: 'Store multiple values in persistent namespaced memory from one source collection.',
        schema: StoreManySchema,
        exportsSchema: MemoryBatchStoreResultSchema,
        handler: async (ctx, payload) => {
          const entries = resolveStoreManyEntries(payload);
          storeMemoryValues(ctx.runtime.configDir, payload.namespace, entries);
          const result = {
            stored: true as const,
            namespace: payload.namespace,
            count: entries.length,
            keys: entries.map((entry) => entry.key),
          };
          return {
            response: result,
            exports: result,
            detail: `stored ${entries.length} key(s) in ${payload.namespace}`,
          };
        },
      }),
      recall: defineAction({
        description: 'Recall a value by key from persistent namespaced memory.',
        schema: RecallSchema,
        exportsSchema: MemoryRecallResultSchema,
        handler: async (ctx, payload) => {
          const recalled = recallMemoryValue(ctx.runtime.configDir, payload.namespace, payload.key);
          const result = {
            found: recalled.found,
            namespace: payload.namespace,
            key: payload.key,
            value: recalled.found ? recalled.value : payload.defaultValue,
          };
          return {
            response: result,
            exports: result,
            detail: recalled.found ? `recalled ${payload.namespace}.${payload.key}` : `missing ${payload.namespace}.${payload.key}`,
          };
        },
      }),
      'recall-many': defineAction({
        description: 'Recall multiple values by key from persistent namespaced memory.',
        schema: RecallManySchema,
        exportsSchema: MemoryRecallManyResultSchema,
        handler: async (ctx, payload) => {
          const results = recallMemoryValues(ctx.runtime.configDir, payload.namespace, payload.keys, payload.defaultValue);
          const missingKeys = results.filter((result) => !result.found).map((result) => result.key);
          const result = {
            namespace: payload.namespace,
            results,
            foundCount: results.length - missingKeys.length,
            missingKeys,
          };
          return {
            response: result,
            exports: result,
            detail: `recalled ${result.foundCount}/${results.length} key(s) from ${payload.namespace}`,
          };
        },
      }),
      list: defineAction({
        description: 'List all memory namespaces, or inspect keys and values in one namespace.',
        schema: ListSchema,
        handler: async (ctx, payload) => {
          if (payload.namespace === undefined) {
            const namespaces = listMemoryNamespaces(ctx.runtime.configDir);
            return {
              response: {
                namespaces: namespaces.map((n) => n.namespace),
                count: namespaces.length,
              },
              detail: `listed ${namespaces.length} namespace(s)`,
            };
          }
          if (payload.prefix !== undefined) {
            const listed = listMemoryByPrefix(ctx.runtime.configDir, payload.namespace, payload.prefix);
            return {
              response: {
                namespace: payload.namespace,
                prefix: listed.prefix,
                keys: listed.keys,
                count: listed.count,
                contents: listed.contents,
              },
              detail: `inspected namespace=${payload.namespace} prefix=${listed.prefix} keys=${listed.count}`,
            };
          }
          const contents = readMemoryNamespace(ctx.runtime.configDir, payload.namespace);
          const keys = Object.keys(contents);
          return {
            response: {
              namespace: payload.namespace,
              keys,
              count: keys.length,
              contents,
            },
            detail: `inspected namespace=${payload.namespace} keys=${keys.length}`,
          };
        },
      }),
      forget: defineAction({
        description: 'Forget one key or clear one namespaced persistent memory store.',
        schema: ForgetSchema,
        handler: async (ctx, payload) => {
          if (payload.all) {
            return {
              response: {
                cleared: true,
                namespace: payload.namespace,
                removed: clearMemoryNamespace(ctx.runtime.configDir, payload.namespace),
              },
              detail: `cleared namespace=${payload.namespace}`,
            };
          }
          const forgotten = forgetMemoryValue(ctx.runtime.configDir, payload.namespace, payload.key);
          return {
            response: {
              cleared: false,
              namespace: payload.namespace,
              key: payload.key,
              forgotten,
            },
            detail: forgotten ? `forgot ${payload.namespace}.${payload.key}` : `missing ${payload.namespace}.${payload.key}`,
          };
        },
      }),
    },
  });

  return {
    ...moduleDef,
    layer: 'builtin',
    sourcePath,
  };
}
