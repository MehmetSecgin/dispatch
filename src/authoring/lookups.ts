export type ResolverOptions = {
	field: string;
	defaultKey?: string;
	normalize?: 'upper' | 'lower' | 'none';
};

function normalizeLookupKey(
	input: string | undefined,
	normalize: ResolverOptions['normalize'],
	defaultKey?: string
): string {
	const base = String(input ?? defaultKey ?? '').trim();
	if (!base) return '';
	if (normalize === 'upper') return base.toUpperCase();
	if (normalize === 'lower') return base.toLowerCase();
	return base;
}

export function resolveLookupValue<T>(
	lookup: Record<string, T>,
	input: string | undefined,
	options: ResolverOptions
): T {
	const key = normalizeLookupKey(
		input,
		options.normalize ?? 'none',
		options.defaultKey
	);
	const resolved = lookup[key];
	if (resolved !== undefined) return resolved;

	throw new Error(
		`Unsupported ${options.field} '${input}'. Supported ${options.field} values: ${Object.keys(
			lookup
		).join(', ')}`
	);
}
