import { z } from "zod";

export const ProblemFieldErrorSchema = z.object({
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
});
export type ProblemFieldError = z.infer<typeof ProblemFieldErrorSchema>;

export const ProblemDetailsSchema = z.object({
  type: z.string().trim().min(1),
  title: z.string().trim().min(1),
  status: z.number().int().min(400).max(599),
  code: z.string().trim().min(1),
  correlationId: z.string().trim().min(1),
  detail: z.string().trim().min(1).optional(),
  instance: z.string().trim().min(1).optional(),
  errors: z.array(ProblemFieldErrorSchema).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;
