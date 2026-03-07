import { ModuleDefinition, defineAction, defineModule } from '../../types.js';
import { parseDurationMs, sleep } from '../../../core/time.js';
import { executeFlowPoll } from './poll.js';
import { FlowPollPayloadSchema, FlowSleepSchema } from './schemas.js';

export function createFlowModule(sourcePath: string): ModuleDefinition {
  const moduleDef = defineModule({
    name: 'flow',
    version: '1.0.0',
    actions: {
      sleep: defineAction({
        description: 'Pause execution for a deterministic duration.',
        schema: FlowSleepSchema,
        handler: async (_ctx, payload) => {
          const duration = String(payload.duration);
          const ms = parseDurationMs(duration);
          await sleep(ms);
          return { response: { slept: duration }, detail: `slept=${duration}` };
        },
      }),
      poll: defineAction({
        description: 'Call another action repeatedly until JSONPath conditions match or timeout/attempt limit is reached.',
        schema: FlowPollPayloadSchema,
        handler: async (ctx, rawPayload) => {
          const payload = FlowPollPayloadSchema.parse(rawPayload);
          return executeFlowPoll(ctx, payload);
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
