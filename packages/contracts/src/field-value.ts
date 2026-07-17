import { z } from "zod";

export const UnknownFieldReasonSchema = z.enum([
  "source_not_stated",
  "parse_failed",
  "not_yet_verified",
]);
export type UnknownFieldReason = z.infer<typeof UnknownFieldReasonSchema>;

export type FieldValue<T> =
  | {
      state: "known";
      value: T;
      evidenceRefs: string[];
    }
  | {
      state: "unknown";
      reason: UnknownFieldReason;
    }
  | {
      state: "conflict";
      rawValues: string[];
      evidenceRefs: string[];
    };

const EvidenceRefSchema = z.string().trim().min(1);

export const fieldValueSchema = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.discriminatedUnion("state", [
    z.object({
      state: z.literal("known"),
      value: valueSchema,
      evidenceRefs: z.array(EvidenceRefSchema).min(1),
    }),
    z.object({
      state: z.literal("unknown"),
      reason: UnknownFieldReasonSchema,
    }),
    z.object({
      state: z.literal("conflict"),
      rawValues: z.array(z.string().trim().min(1)).min(2),
      evidenceRefs: z.array(EvidenceRefSchema).min(2),
    }),
  ]);
