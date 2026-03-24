import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	normalizePositiveInteger,
	normalizePositiveIntegerList,
	resolveAliasValue,
} from '../../src/authoring/inputs.js';

describe('normalizePositiveInteger', () => {
	it('passes through a valid number', () => {
		expect(normalizePositiveInteger(42, 'id')).toBe(42);
	});

	it('parses a string to number', () => {
		expect(normalizePositiveInteger('7', 'id')).toBe(7);
	});

	it('rejects zero', () => {
		expect(() => normalizePositiveInteger(0, 'id')).toThrow('id must be a positive integer');
	});

	it('rejects negative numbers', () => {
		expect(() => normalizePositiveInteger(-1, 'id')).toThrow('id must be a positive integer');
	});

	it('rejects non-numeric strings', () => {
		expect(() => normalizePositiveInteger('abc', 'id')).toThrow('id must be a positive integer');
	});

	it('rejects floats', () => {
		expect(() => normalizePositiveInteger(1.5, 'id')).toThrow('id must be a positive integer');
	});
});

describe('normalizePositiveIntegerList', () => {
	it('normalizes a mixed array', () => {
		expect(normalizePositiveIntegerList([1, '2', 3], 'ids')).toEqual([1, 2, 3]);
	});

	it('rejects an empty array', () => {
		expect(() => normalizePositiveIntegerList([], 'ids')).toThrow('ids must not be empty');
	});

	it('rejects duplicate values', () => {
		expect(() => normalizePositiveIntegerList([1, 1], 'ids')).toThrow('duplicate ids value: 1');
	});

	it('rejects invalid entries', () => {
		expect(() => normalizePositiveIntegerList([0], 'ids')).toThrow('must be a positive integer');
	});
});

describe('resolveAliasValue', () => {
	it('resolves the first matching key', () => {
		const input = { eventId: '123', id: '456' };
		expect(resolveAliasValue(input, 'event', ['eventId', 'id'])).toBe('123');
	});

	it('falls back to later keys', () => {
		const input = { id: '456' };
		expect(resolveAliasValue(input, 'event', ['eventId', 'id'])).toBe('456');
	});

	it('returns undefined when not required and no match', () => {
		expect(resolveAliasValue({}, 'event', ['eventId'])).toBeUndefined();
	});

	it('throws when required and no match', () => {
		expect(() =>
			resolveAliasValue({}, 'event', ['eventId'], { required: true })
		).toThrow('event is required');
	});

	it('includes env var name in error when required with envVar', () => {
		expect(() =>
			resolveAliasValue({}, 'event', ['eventId'], { required: true, envVar: 'EVENT_ID' })
		).toThrow('event is required or EVENT_ID must be set');
	});

	it('falls back to env var', () => {
		const original = process.env.TEST_ALIAS_VAR;
		process.env.TEST_ALIAS_VAR = 'from-env';
		try {
			expect(
				resolveAliasValue({}, 'event', ['eventId'], { envVar: 'TEST_ALIAS_VAR' })
			).toBe('from-env');
		} finally {
			if (original === undefined) delete process.env.TEST_ALIAS_VAR;
			else process.env.TEST_ALIAS_VAR = original;
		}
	});

	it('trims whitespace from resolved values', () => {
		expect(resolveAliasValue({ id: '  abc  ' }, 'event', ['id'])).toBe('abc');
	});
});
