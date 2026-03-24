import { describe, it, expect, vi } from 'vitest';
import { appendActivity } from '../../src/authoring/activity.js';
import type { ActionContext } from '../../src/modules/types.js';

function makeCtx(): ActionContext {
	return {
		artifacts: { appendActivity: vi.fn() },
		http: {} as ActionContext['http'],
		runtime: {} as ActionContext['runtime'],
		step: {} as ActionContext['step'],
		resolve: () => null,
	};
}

describe('appendActivity', () => {
	it('logs action name with no fields', () => {
		const ctx = makeCtx();
		appendActivity(ctx, 'login');
		expect(ctx.artifacts.appendActivity).toHaveBeenCalledWith('login');
	});

	it('formats key=value fields', () => {
		const ctx = makeCtx();
		appendActivity(ctx, 'update-status', { status: 'active', count: 3 });
		expect(ctx.artifacts.appendActivity).toHaveBeenCalledWith(
			'update-status status=active count=3'
		);
	});

	it('filters out null and undefined values', () => {
		const ctx = makeCtx();
		appendActivity(ctx, 'publish', { id: 'abc', removed: null, missing: undefined });
		expect(ctx.artifacts.appendActivity).toHaveBeenCalledWith('publish id=abc');
	});

	it('joins array values with commas', () => {
		const ctx = makeCtx();
		appendActivity(ctx, 'resolve', { ids: [1, 2, 3] });
		expect(ctx.artifacts.appendActivity).toHaveBeenCalledWith('resolve ids=1,2,3');
	});

	it('handles boolean values', () => {
		const ctx = makeCtx();
		appendActivity(ctx, 'toggle', { enabled: true });
		expect(ctx.artifacts.appendActivity).toHaveBeenCalledWith('toggle enabled=true');
	});

	it('falls back to action-only when all fields are null/undefined', () => {
		const ctx = makeCtx();
		appendActivity(ctx, 'noop', { a: null, b: undefined });
		expect(ctx.artifacts.appendActivity).toHaveBeenCalledWith('noop');
	});
});
