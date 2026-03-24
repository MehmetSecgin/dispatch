import { defineAction, defineModule } from '../../types.js';
import { ModuleDefinition } from '../../internal-types.js';
import { ForgetSchema, ListSchema, RecallSchema, StoreSchema } from './schemas.js';
import {
  clearMemoryNamespace,
  forgetMemoryValue,
  listMemoryNamespaces,
  readMemoryNamespace,
  recallMemoryValue,
  storeMemoryValue,
} from './store.js';

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
      recall: defineAction({
        description: 'Recall a value by key from persistent namespaced memory.',
        schema: RecallSchema,
        handler: async (ctx, payload) => {
          const recalled = recallMemoryValue(ctx.runtime.configDir, payload.namespace, payload.key);
          return {
            response: {
              found: recalled.found,
              namespace: payload.namespace,
              key: payload.key,
              value: recalled.found ? recalled.value : payload.defaultValue,
            },
            detail: recalled.found ? `recalled ${payload.namespace}.${payload.key}` : `missing ${payload.namespace}.${payload.key}`,
          };
        },
      }),
      list: defineAction({
        description: 'List all memory namespaces, or inspect all keys and values in one namespace.',
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
