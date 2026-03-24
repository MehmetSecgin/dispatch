import { describe, it, expect, vi } from 'vitest';
import { requireCredential } from '../../src/authoring/credentials.js';
import type { ActionContext } from '../../src/modules/types.js';

function makeCtx(credential?: unknown): ActionContext {
	return {
		artifacts: { appendActivity: vi.fn() },
		http: {} as ActionContext['http'],
		runtime: {} as ActionContext['runtime'],
		step: {} as ActionContext['step'],
		resolve: () => null,
		credential,
	};
}

describe('requireCredential', () => {
	it('returns the credential when present', () => {
		const cred = { username: 'admin', password: 'secret' };
		const result = requireCredential<typeof cred>(makeCtx(cred), 'admin.login');
		expect(result).toBe(cred);
	});

	it('throws with action name when credential is missing', () => {
		expect(() => requireCredential(makeCtx(), 'admin.login')).toThrow(
			'admin.login requires a bound credential profile'
		);
	});

	it('throws when credential is undefined', () => {
		expect(() => requireCredential(makeCtx(undefined), 'test.action')).toThrow(
			'test.action requires a bound credential profile'
		);
	});
});
