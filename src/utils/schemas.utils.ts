import { z } from '@hono/zod-openapi';

export const paginationSchema = z.object({
  offset: z.coerce.number().min(0).default(0),
  limit: z.coerce.number().min(1).default(10),
});

export const UUIDParamsSchema = z.object({
  id: z.string().uuid().openapi({
    example: '123e4567-e89b-12d3-a456-426614174000',
  }),
});

export const notFoundSchema = z.object({
  message: z.string().openapi({
    example: 'Recipe not found',
  }),
});
