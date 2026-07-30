import { z } from "zod";

export const IdentifierSchema = z.string().trim().min(1);
export const UuidSchema = z.string().uuid();
export const TimestampSchema = z.string().datetime({ offset: true });
export const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const RevisionSchema = z.number().int().positive();

export const HttpsUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    },
    {
      message: "Only HTTPS URLs are allowed",
    },
  );

export const JsonScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const JsonRecordSchema = z.record(z.string(), z.unknown());
