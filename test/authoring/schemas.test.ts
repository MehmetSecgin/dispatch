import { describe, it, expect } from 'vitest';
import {
	NonEmptyStringSchema,
	PositiveIntegerSchema,
	PositiveIntegerLikeSchema,
	PositiveIntegerArraySchema,
	UuidSchema,
} from '../../src/authoring/schemas.js';

describe('NonEmptyStringSchema', () => {
	it('accepts a non-empty string', () => {
		expect(NonEmptyStringSchema.safeParse('hello').success).toBe(true);
	});

	it('rejects an empty string', () => {
		expect(NonEmptyStringSchema.safeParse('').success).toBe(false);
	});
});

describe('PositiveIntegerSchema', () => {
	it('accepts a positive integer', () => {
		expect(PositiveIntegerSchema.safeParse(1).success).toBe(true);
	});

	it('rejects zero', () => {
		expect(PositiveIntegerSchema.safeParse(0).success).toBe(false);
	});

	it('rejects negative', () => {
		expect(PositiveIntegerSchema.safeParse(-1).success).toBe(false);
	});

	it('rejects float', () => {
		expect(PositiveIntegerSchema.safeParse(1.5).success).toBe(false);
	});
});

describe('PositiveIntegerLikeSchema', () => {
	it('accepts a number', () => {
		expect(PositiveIntegerLikeSchema.safeParse(42).success).toBe(true);
	});

	it('accepts a numeric string', () => {
		expect(PositiveIntegerLikeSchema.safeParse('123').success).toBe(true);
	});

	it('rejects a non-numeric string', () => {
		expect(PositiveIntegerLikeSchema.safeParse('abc').success).toBe(false);
	});
});

describe('PositiveIntegerArraySchema', () => {
	it('accepts a non-empty array of positive integers', () => {
		expect(PositiveIntegerArraySchema.safeParse([1, 2, 3]).success).toBe(true);
	});

	it('rejects an empty array', () => {
		expect(PositiveIntegerArraySchema.safeParse([]).success).toBe(false);
	});
});

describe('UuidSchema', () => {
	it('accepts a valid UUID', () => {
		expect(UuidSchema.safeParse('550e8400-e29b-41d4-a716-446655440000').success).toBe(true);
	});

	it('rejects an invalid UUID', () => {
		expect(UuidSchema.safeParse('not-a-uuid').success).toBe(false);
	});
});
