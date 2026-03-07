import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as dispatchkit from '../src/index.ts';
import { ModuleRegistry } from '../src/modules/registry.ts';
import { loadBuiltinModules } from '../src/modules/builtin/index.ts';
import { defineModule, defineAction } from '../src/modules/types.ts';

describe('module registry', () => {
  it('resolves every declared builtin action key', () => {
    const registry = new ModuleRegistry();
    const builtins = loadBuiltinModules();
    for (const mod of builtins) registry.register(mod);

    for (const mod of builtins) {
      for (const actionName of Object.keys(mod.actions)) {
        const actionKey = `${mod.name}.${actionName}`;
        const resolved = registry.resolve(actionKey);
        expect(resolved).not.toBeNull();
        expect(resolved?.moduleName).toBe(mod.name);
        expect(resolved?.actionName).toBe(actionName);
      }
    }

    expect(registry.resolve('nonexistent.action')).toBeNull();
  });

  it('prefers newer registrations and records override conflicts', () => {
    const registry = new ModuleRegistry();
    for (const mod of loadBuiltinModules()) registry.register(mod);

    registry.register({
      name: 'flow',
      version: '1.0.0',
      layer: 'user',
      sourcePath: 'test:flow-custom',
      actions: {
        sleep: {
          description: 'override flow sleep',
          schema: z.any(),
          handler: async () => ({ response: { ok: true } }),
        },
      },
    });

    const resolved = registry.resolve('flow.sleep');
    expect(resolved).not.toBeNull();
    expect(resolved?.layer).toBe('user');

    const conflicts = registry.listConflicts();
    expect(conflicts.some(c => c.actionKey === 'flow.sleep')).toBe(true);
  });

  it('defineModule + defineAction returns correct shapes with schema preserved', () => {
    const mySchema = z.object({ url: z.string().url() });
    const action = defineAction({
      description: 'fetch a URL',
      schema: mySchema,
      handler: async (_ctx, payload) => ({ response: { url: payload.url } }),
    });

    const mod = defineModule({
      name: 'test-mod',
      version: '1.0.0',
      actions: { fetch: action },
    });

    expect(mod.name).toBe('test-mod');
    expect(mod.actions.fetch.description).toBe('fetch a URL');
    expect(mod.actions.fetch.schema).toBe(mySchema);

    // Schema validates correctly
    const good = mod.actions.fetch.schema.safeParse({ url: 'https://example.com' });
    expect(good.success).toBe(true);
    const bad = mod.actions.fetch.schema.safeParse({ url: 'not-a-url' });
    expect(bad.success).toBe(false);
  });

  it('re-exports defineModule + defineAction from the package root entry', () => {
    expect(dispatchkit.defineModule).toBe(defineModule);
    expect(dispatchkit.defineAction).toBe(defineAction);
  });

  it('resolves actions from map-based custom modules', () => {
    const registry = new ModuleRegistry();
    registry.register({
      name: 'sample',
      version: '1.0.0',
      layer: 'repo',
      sourcePath: 'test:sample',
      actions: {
        get: {
          description: 'sample get',
          schema: z.object({ endpoint: z.string() }),
          handler: async () => ({ response: {} }),
        },
        post: {
          description: 'sample post',
          schema: z.object({ endpoint: z.string(), body: z.any() }),
          handler: async () => ({ response: {} }),
        },
      },
    });

    expect(registry.resolve('sample.get')).not.toBeNull();
    expect(registry.resolve('sample.post')).not.toBeNull();
    expect(registry.resolve('sample.delete')).toBeNull();
    const get = registry.resolve('sample.get');
    const post = registry.resolve('sample.post');
    expect(get?.moduleName).toBe('sample');
    expect(get?.actionName).toBe('get');
    expect(post?.moduleName).toBe('sample');
    expect(post?.actionName).toBe('post');
  });
});
