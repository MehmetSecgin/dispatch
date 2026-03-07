import { ModuleDefinition, defineAction, defineModule } from '../../types.js';
import { ForgetSchema, RecallSchema, StoreSchema } from './schemas.js';
import { readMemory, writeMemory } from './store.js';

export function createMemoryModule(sourcePath: string): ModuleDefinition {
  const moduleDef = defineModule({
    name: 'memory',
    version: '1.0.0',
    actions: {
      store: defineAction({
        description: 'Store a value by key in persistent memory.',
        schema: StoreSchema,
        handler: async (ctx, payload) => {
          const state = readMemory(ctx.runtime.configDir);
          state[payload.key] = payload.value;
          writeMemory(ctx.runtime.configDir, state);
          return {
            response: {
              stored: true,
              key: payload.key,
              value: payload.value,
            },
            detail: `stored key=${payload.key}`,
          };
        },
      }),
      recall: defineAction({
        description: 'Recall a value by key from persistent memory.',
        schema: RecallSchema,
        handler: async (ctx, payload) => {
          const state = readMemory(ctx.runtime.configDir);
          const found = Object.prototype.hasOwnProperty.call(state, payload.key);
          return {
            response: {
              found,
              key: payload.key,
              value: found ? state[payload.key] : payload.defaultValue,
            },
            detail: found ? `recalled key=${payload.key}` : `missing key=${payload.key}`,
          };
        },
      }),
      forget: defineAction({
        description: 'Forget one key or clear all persistent memory.',
        schema: ForgetSchema,
        handler: async (ctx, payload) => {
          const state = readMemory(ctx.runtime.configDir);
          if (payload.all) {
            writeMemory(ctx.runtime.configDir, {});
            return {
              response: {
                cleared: true,
                removed: Object.keys(state).length,
              },
              detail: 'cleared all memory',
            };
          }
          const key = payload.key;
          const forgotten = Object.prototype.hasOwnProperty.call(state, key);
          if (forgotten) {
            delete state[key];
            writeMemory(ctx.runtime.configDir, state);
          }
          return {
            response: {
              cleared: false,
              key,
              forgotten,
            },
            detail: forgotten ? `forgot key=${key}` : `missing key=${key}`,
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
