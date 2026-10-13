import { z } from "zod";
const MonthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
const CitedTextSchema = z
  .object({
    value: z.string().trim().min(1).max(10000),
    quote: z.string().trim().min(1).max(10000),
  })
  .strict();
export const RecruitmentPlanDraftSchema = z
  .object({
    sourceKey: z.string().regex(/^[a-z0-9-]+$/),
    planKey: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(100),
    expectedRevision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(240),
    recruitmentYear: z.number().int().min(2000).max(2100),
    batch: z.string().trim().min(1).max(100),
    graduationWindow: z
      .object({ from: MonthSchema, to: MonthSchema, quote: z.string().trim().min(1).max(10000) })
      .strict()
      .nullable(),
    volunteerRules: CitedTextSchema.nullable(),
    evidenceUrl: z.string().url().max(3000),
    evidenceText: z.string().trim().min(1).max(200000),
    yearQuote: z.string().trim().min(1).max(10000),
    verifiedAt: z.string().datetime(),
    jobVersionIds: z
      .array(z.string().uuid())
      .max(1000)
      .refine((ids) => new Set(ids).size === ids.length),
    confirmedOfficialEvidence: z.literal(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const [name, quote] of [
      ["yearQuote", value.yearQuote],
      ["graduationWindow", value.graduationWindow?.quote],
      ["volunteerRules", value.volunteerRules?.quote],
    ] as const) {
      if (quote && !value.evidenceText.includes(quote))
        ctx.addIssue({
          code: "custom",
          path: [name],
          message: "结论必须附属于本次官方原文的引句。",
        });
    }
    if (!value.yearQuote.includes(String(value.recruitmentYear)))
      ctx.addIssue({
        code: "custom",
        path: ["yearQuote"],
        message: "适用招聘年份须在原句中明确出现。",
      });
    if (value.graduationWindow && value.graduationWindow.from > value.graduationWindow.to)
      ctx.addIssue({
        code: "custom",
        path: ["graduationWindow"],
        message: "毕业月份窗口起点不得晚于终点。",
      });
  });
export type RecruitmentPlanDraft = z.infer<typeof RecruitmentPlanDraftSchema>;
export const RecruitmentPlanSchema = z.object({
  id: z.string().uuid(),
  sourceKey: z.string(),
  planKey: z.string(),
  revision: z.number().int().positive(),
  title: z.string(),
  recruitmentYear: z.number().int(),
  batch: z.string(),
  graduationWindow: z.object({ from: MonthSchema, to: MonthSchema, quote: z.string() }).nullable(),
  volunteerRules: CitedTextSchema.nullable(),
  evidenceUrl: z.string().url(),
  evidenceText: z.string(),
  yearQuote: z.string(),
  verifiedAt: z.string().datetime(),
});
export const RecruitmentPlanResponseSchema = z.object({
  plan: RecruitmentPlanSchema.nullable(),
  context: z.enum(["current", "case_snapshot"]),
  notice: z.string(),
});
