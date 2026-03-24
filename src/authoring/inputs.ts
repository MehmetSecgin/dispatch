type PositiveIntegerLike = number | string;

function uniquePositiveIntegers(values: number[], field: string): void {
	const seen = new Set<number>();
	for (const value of values) {
		if (!Number.isInteger(value) || value <= 0) {
			throw new Error(`${field} must contain only positive integers`);
		}
		if (seen.has(value)) {
			throw new Error(`duplicate ${field} value: ${value}`);
		}
		seen.add(value);
	}
}

export function normalizePositiveInteger(
	value: PositiveIntegerLike,
	field: string
): number {
	const normalized =
		typeof value === 'number' ? value : Number.parseInt(value, 10);
	if (!Number.isInteger(normalized) || normalized <= 0) {
		throw new Error(`${field} must be a positive integer`);
	}
	return normalized;
}

export function normalizePositiveIntegerList(
	value: Array<PositiveIntegerLike>,
	field: string
): number[] {
	const normalized = value.map((entry, index) => {
		if (typeof entry !== 'number' && typeof entry !== 'string') {
			throw new Error(`${field} must contain only strings or numbers`);
		}
		return normalizePositiveInteger(entry, `${field}[${index}]`);
	});
	if (normalized.length === 0) throw new Error(`${field} must not be empty`);
	uniquePositiveIntegers(normalized, field);
	return normalized;
}

export function resolveAliasValue(
	input: Record<string, unknown>,
	field: string,
	keys: string[],
	options: { envVar?: string; required?: boolean } = {}
): string | undefined {
	const resolved = keys
		.map((key) => input[key])
		.find((value) => value !== undefined && value !== null);

	const fallback =
		resolved ??
		(options.envVar ? process.env[options.envVar] : undefined);
	const normalized = String(fallback ?? '').trim();

	if (!normalized) {
		if (options.required) {
			if (options.envVar) {
				throw new Error(`${field} is required or ${options.envVar} must be set`);
			}
			throw new Error(`${field} is required`);
		}
		return undefined;
	}

	return normalized;
}
