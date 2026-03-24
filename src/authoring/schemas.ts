import { z } from 'zod';

export const NonEmptyStringSchema = z.string().min(1);
export const PositiveIntegerSchema = z.number().int().positive();
export const PositiveIntegerLikeSchema = z.union([
	PositiveIntegerSchema,
	z.string().regex(/^\d+$/, 'Expected positive integer')
]);
export const PositiveIntegerArraySchema = z.array(PositiveIntegerSchema).min(1);
export const UuidSchema = z.uuid();
