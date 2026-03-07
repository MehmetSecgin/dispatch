import { interpolateAny } from '../../../execution/interpolation.js';
import { evaluateConditionGroup, pickJsonPath } from '../../../execution/conditions.js';
import { sleep } from '../../../core/time.js';
import type { JsonObject } from '../../../core/json.js';
import type { ActionContext } from '../../types.js';
import type { FlowPollPayload } from './schemas.js';

function applyStoreMappings(store: Record<string, string>, response: unknown, run: JsonObject): void {
  for (const [key, jsonPath] of Object.entries(store)) {
    const value = pickJsonPath(jsonPath, response);
    if (value !== undefined) run[key] = value;
  }
}

export async function executeFlowPoll(ctx: ActionContext, payload: FlowPollPayload) {
  const resolved = ctx.resolve(payload.action);
  if (!resolved) throw new Error(`flow.poll unknown target action '${payload.action}'`);
  if (resolved.actionKey === 'flow.poll') throw new Error('flow.poll cannot target flow.poll (direct recursion blocked)');

  const maxAttemptsLabel = payload.maxAttempts ?? 'unbounded';
  const minSuccessAttempts = payload.minSuccessAttempts ?? 1;
  const emit = (message: string) => {
    ctx.progress?.(message);
  };
  emit(`poll start target=${payload.action} interval=${payload.intervalMs}ms maxDuration=${payload.maxDurationMs}ms maxAttempts=${maxAttemptsLabel} minSuccessAttempts=${minSuccessAttempts}`);

  const startedAt = Date.now();
  const maxAttempts = payload.maxAttempts ?? Number.MAX_SAFE_INTEGER;
  let attempts = 0;
  let lastStatus: 'success' | 'error' = 'error';
  let lastResponse: unknown = null;
  let lastError: string | null = null;
  let lastConditionSummaries: string[] = [];

  while ((Date.now() - startedAt) <= payload.maxDurationMs && attempts < maxAttempts) {
    attempts += 1;
    try {
      const targetPayload = interpolateAny(payload.payload ?? {}, ctx.runtime);
      const parseResult = resolved.definition.schema.safeParse(targetPayload);
      if (!parseResult.success) {
        const errors = parseResult.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`);
        throw new Error(`target payload validation failed: ${errors.join('; ')}`);
      }

      const targetStep = {
        ...ctx.step,
        id: `${ctx.step.id}_attempt_${attempts}`,
        action: resolved.actionKey,
        payload: targetPayload,
      };

      const result = await resolved.definition.handler({ ...ctx, step: targetStep }, targetPayload);
      lastStatus = 'success';
      lastResponse = result.response ?? {};
      lastError = null;
      const evaluation = evaluateConditionGroup(payload.conditions, lastResponse);
      lastConditionSummaries = evaluation.summaries;
      if (evaluation.matched) {
        if (attempts < minSuccessAttempts) {
          const elapsedMs = Date.now() - startedAt;
          const attemptsGateSummary = `minSuccessAttempts ${minSuccessAttempts} reached => false`;
          lastConditionSummaries = [...evaluation.summaries, attemptsGateSummary];
          ctx.artifacts.appendActivity(`flow.poll attempt=${attempts} status=success matched=false reason=minSuccessAttempts target=${payload.action}`);
          emit(`attempt=${attempts}/${maxAttemptsLabel} status=success matched=false elapsed=${(elapsedMs / 1000).toFixed(1)}s next=${payload.intervalMs}ms conditions=${attemptsGateSummary}`);
          if ((Date.now() - startedAt) > payload.maxDurationMs || attempts >= maxAttempts) break;
          await sleep(payload.intervalMs);
          continue;
        }

        applyStoreMappings(payload.store, lastResponse, ctx.runtime.run);
        const elapsedMs = Date.now() - startedAt;
        ctx.artifacts.appendActivity(`flow.poll matched attempt=${attempts} target=${payload.action} elapsedMs=${elapsedMs}`);
        return {
          response: {
            matched: true,
            attempts,
            elapsedMs,
            lastAction: payload.action,
            lastStatus,
            lastResponse,
          },
          detail: `matched=true attempts=${attempts} elapsed=${(elapsedMs / 1000).toFixed(1)}s`,
        };
      }

      const elapsedMs = Date.now() - startedAt;
      const snippet = lastConditionSummaries.slice(0, 2).join(' | ') || 'no-condition-summary';
      ctx.artifacts.appendActivity(`flow.poll attempt=${attempts} status=success matched=false target=${payload.action}`);
      emit(`attempt=${attempts}/${maxAttemptsLabel} status=success matched=false elapsed=${(elapsedMs / 1000).toFixed(1)}s next=${payload.intervalMs}ms conditions=${snippet}`);
    } catch (err) {
      lastStatus = 'error';
      lastError = err instanceof Error ? err.message : String(err);
      const elapsedMs = Date.now() - startedAt;
      ctx.artifacts.appendActivity(`flow.poll attempt=${attempts} status=error target=${payload.action} error=${lastError}`);
      emit(`attempt=${attempts}/${maxAttemptsLabel} status=error elapsed=${(elapsedMs / 1000).toFixed(1)}s next=${payload.intervalMs}ms error=${lastError}`);
      if (!payload.continueOnActionError) {
        throw new Error(`flow.poll target '${payload.action}' failed on attempt ${attempts}: ${lastError}`);
      }
    }

    if ((Date.now() - startedAt) > payload.maxDurationMs || attempts >= maxAttempts) break;
    await sleep(payload.intervalMs);
  }

  const elapsedMs = Date.now() - startedAt;
  const conditionSnippet = lastConditionSummaries.slice(0, 4).join(' | ') || 'n/a';
  throw new Error(
    `flow.poll timeout action=${payload.action} attempts=${attempts} elapsedMs=${elapsedMs} `
    + `maxDurationMs=${payload.maxDurationMs} maxAttempts=${payload.maxAttempts ?? 'unbounded'} `
    + `minSuccessAttempts=${minSuccessAttempts} `
    + `lastStatus=${lastStatus} lastError=${lastError ?? 'none'} conditionResults=${conditionSnippet}`,
  );
}
