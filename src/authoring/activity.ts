import type { ActionContext } from '../modules/types.js';

export type ActivityValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| Array<string | number | boolean>;

function formatActivityValue(value: ActivityValue): string {
	if (Array.isArray(value)) return value.map((entry) => String(entry)).join(',');
	return String(value);
}

export function appendActivity(
	ctx: ActionContext,
	action: string,
	fields: Record<string, ActivityValue> = {}
): void {
	const segments = Object.entries(fields)
		.filter(([, value]) => value !== undefined && value !== null)
		.map(([key, value]) => `${key}=${formatActivityValue(value)}`);

	ctx.artifacts.appendActivity(
		segments.length > 0 ? `${action} ${segments.join(' ')}` : action
	);
}
