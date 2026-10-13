import { z } from "zod";
export const AssistantTaskSchema = z.enum([
  "experience",
  "resume_review",
  "interview",
  "job_explanation",
  "expression",
]);
export type AssistantTask = z.infer<typeof AssistantTaskSchema>;
export const AssistantContextSchema = z
  .object({
    documentId: z.string().uuid().optional(),
    contentRevisionId: z.string().uuid().optional(),
    layoutRevisionId: z.string().uuid().optional(),
    experienceIds: z.array(z.string().uuid()).max(30).default([]),
    caseId: z.string().uuid().optional(),
    jobId: z.string().uuid().optional(),
    direction: z.string().max(200).default(""),
    initialText: z.string().max(30000).default(""),
  })
  .strict();
export const CreateAssistantSessionSchema = z
  .object({
    task: AssistantTaskSchema,
    title: z.string().max(200).default("求职助手"),
    context: AssistantContextSchema,
    pace: z.enum(["guided", "simulation"]).default("guided"),
    expressionKind: z
      .enum(["introduction", "project_long", "project_short", "email", "other"])
      .default("introduction"),
    length: z.enum(["short", "standard", "long"]).default("standard"),
    workflow: z.enum(["dialogue", "resume_prepare"]).default("dialogue"),
  })
  .strict();
export const AssistantChangeSchema = z
  .object({
    id: z.string().min(1).max(80),
    target: z.enum(["entry_body", "entry_title", "headline", "section_order"]),
    entryId: z.string().min(1).max(500).nullable(),
    sectionIds: z.array(z.string().min(1).max(500)).max(40),
    text: z.string().max(12000),
    reason: z.string().max(1000),
    sourceQuotes: z.array(z.string().min(1).max(1000)).min(1).max(8),
  })
  .strict();
export const AssistantResultSchema = z
  .object({
    schemaVersion: z.literal("career-assistant-result-v1"),
    kind: z.enum(["question", "draft", "feedback", "clarification"]),
    reply: z.string().min(1).max(5000),
    question: z.string().max(1500).nullable(),
    artifact: z
      .object({
        title: z.string().max(200),
        body: z.string().max(15000),
        sourceQuotes: z.array(z.string().min(1).max(1000)).max(20),
      })
      .strict()
      .nullable(),
    changes: z.array(AssistantChangeSchema).max(30),
    preparation: z
      .array(z.object({ title: z.string().min(1).max(200), detail: z.string().max(2000) }).strict())
      .max(10),
    known: z.array(z.string().max(400)).max(20),
    openQuestions: z.array(z.string().max(400)).max(10),
    preparationReview: z
      .object({
        status: z.enum(["completed", "failed", "fixed"]),
        summary: z.string().max(5000),
        issues: z
          .array(
            z
              .object({
                changeId: z.string().max(80).nullable(),
                severity: z.enum(["attention", "unsupported_fact"]),
                detail: z.string().max(1500),
              })
              .strict(),
          )
          .max(30),
        failureCode: z.string().max(100).nullable(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const AssistantTurnSchema = z.object({
  id: z.string().uuid(),
  ordinal: z.number(),
  userMessage: z.string(),
  intent: z.enum(["continue", "draft", "skip", "retry", "finish"]),
  questionId: z.string().uuid().nullable(),
  status: z.enum(["queued", "completed", "failed", "fixed"]),
  executionStatus: z.enum(["waiting", "processing"]).nullable().optional(),
  result: AssistantResultSchema.nullable(),
  failureCode: z.string().nullable(),
  model: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export const AssistantSessionSchema = z.object({
  workflow: z.enum(["dialogue", "resume_prepare"]).optional(),
  documentCore: z.enum(["native-v1", "legacy"]).nullable().optional(),
  id: z.string().uuid(),
  task: AssistantTaskSchema,
  title: z.string(),
  pace: z.enum(["guided", "simulation"]),
  status: z.enum(["active", "paused", "completed"]),
  revision: z.number(),
  context: AssistantContextSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  turns: z.array(AssistantTurnSchema),
});
export type AssistantSession = z.infer<typeof AssistantSessionSchema>;
export type AssistantResult = z.infer<typeof AssistantResultSchema>;
export const SubmitAssistantTurnSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    message: z.string().max(12000).default(""),
    intent: z.enum(["continue", "draft", "skip", "retry", "finish"]).default("continue"),
    questionId: z.string().uuid().nullable().default(null),
    mode: z.enum(["ai", "fixed"]).default("ai"),
  })
  .strict();
export const AdoptAssistantResultSchema = z
  .object({
    expectedDraftRevision: z.number().int().nonnegative().optional(),
    changeIds: z.array(z.string()).max(30).default([]),
    target: z.enum(["resume", "expression", "experience", "preparation"]),
    editedBody: z.string().max(15000).optional(),
    title: z.string().max(200).optional(),
  })
  .strict();
