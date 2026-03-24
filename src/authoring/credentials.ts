import type { ActionContext } from '../modules/types.js';

export function requireCredential<T>(
	ctx: ActionContext,
	actionName: string
): T {
	const credential = ctx.credential as T | undefined;
	if (!credential) {
		throw new Error(`${actionName} requires a bound credential profile`);
	}
	return credential;
}
