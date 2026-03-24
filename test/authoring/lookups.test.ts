import { describe, it, expect } from 'vitest';
import { resolveLookupValue } from '../../src/authoring/lookups.js';

const COLORS = { red: '#f00', green: '#0f0', blue: '#00f' };

describe('resolveLookupValue', () => {
	it('resolves an exact key match', () => {
		expect(resolveLookupValue(COLORS, 'red', { field: 'color' })).toBe('#f00');
	});

	it('normalizes input to uppercase', () => {
		const lookup = { USA: 'us', GBR: 'gb' };
		expect(
			resolveLookupValue(lookup, 'usa', { field: 'country', normalize: 'upper' })
		).toBe('us');
	});

	it('normalizes input to lowercase', () => {
		const lookup = { active: 1, inactive: 0 };
		expect(
			resolveLookupValue(lookup, 'ACTIVE', { field: 'status', normalize: 'lower' })
		).toBe(1);
	});

	it('uses defaultKey when input is undefined', () => {
		expect(
			resolveLookupValue(COLORS, undefined, { field: 'color', defaultKey: 'blue' })
		).toBe('#00f');
	});

	it('throws with supported values when key is not found', () => {
		expect(() =>
			resolveLookupValue(COLORS, 'yellow', { field: 'color' })
		).toThrow("Unsupported color 'yellow'. Supported color values: red, green, blue");
	});

	it('throws when input is undefined and no defaultKey', () => {
		expect(() =>
			resolveLookupValue(COLORS, undefined, { field: 'color' })
		).toThrow("Unsupported color 'undefined'");
	});
});
