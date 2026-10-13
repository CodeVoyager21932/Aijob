import { z } from "zod";
import { JobFamilySchema } from "./enums.js";
import { JobGraphScopeSchema, JobGraphResultSchema, JobSemanticAtomSchema } from "./job-graph.js";

export const JOB_SEMANTICS_V2 = "role-semantics-v2";
export const GraphConceptKindSchema = z.enum(["task", "knowledge", "tool", "deliverable", "general", "qualification", "domain", "unclassified"]);
export type GraphConceptKind = z.infer<typeof GraphConceptKindSchema>;
export const GRAPH_GROUPS: readonly { kind: GraphConceptKind; title: string; description: string }[] = [
  { kind: "task", title: "主要做什么", description: "岗位原句中出现的工作任务" },
  { kind: "knowledge", title: "需要理解什么", description: "专业知识、业务知识与方法" },
  { kind: "tool", title: "常用什么工具", description: "软件、语言、平台与设备" },
  { kind: "deliverable", title: "通常形成什么产物", description: "文档、代码、报告与成果" },
  { kind: "general", title: "协作与通用要求", description: "协作、表达与工作方式" },
  { kind: "qualification", title: "申请条件", description: "学历、专业、到岗和其他需要核对的条件" },
  { kind: "domain", title: "工作涉及的领域", description: "业务与应用场景，不直接代表能力要求" },
  { kind: "unclassified", title: "其他原句", description: "尚未稳定归类，保留原文供你查看" },
];
export const GraphAtomV2Schema = JobSemanticAtomSchema.extend({
  kind: GraphConceptKindSchema,
  clauseText: z.string(),
  clauseSpan: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }),
  parentKeys: z.array(z.string()).default([]),
  relatedKeys: z.array(z.string()).default([]),
  choiceGroup: z.object({ id: z.string(), operator: z.enum(["any", "conditional"]), keys: z.array(z.string()), text: z.string() }).nullable().default(null),
});
export type GraphAtomV2 = z.infer<typeof GraphAtomV2Schema>;
export const GraphExampleV2Schema = z.object({
  jobId: z.string().uuid(), jobVersionId: z.string().uuid(), companyName: z.string(), title: z.string(),
  atom: GraphAtomV2Schema, context: z.enum(["public", "private"]).default("public"), caseId: z.string().uuid().optional(),
});
export const GraphItemV2Schema = z.object({
  key: z.string(), label: z.string(), kind: GraphConceptKindSchema,
  jobCount: z.number().int(), companyCount: z.number().int(), mentionRate: z.number().min(0).max(1), companyCoverage: z.number().min(0).max(1),
  requiredJobCount: z.number().int(), preferredJobCount: z.number().int(), unknownJobCount: z.number().int(),
  negatedJobCount: z.number().int(), conditionalJobCount: z.number().int(), dutyJobCount: z.number().int(),
  parentKeys: z.array(z.string()), examples: z.array(GraphExampleV2Schema),
});
export type GraphExampleV2 = z.infer<typeof GraphExampleV2Schema>;
export type GraphItemV2 = z.infer<typeof GraphItemV2Schema>;
export const GraphV2Schema = z.object({
  schemaVersion: z.literal("job-graph-v2"), extractionVersion: z.literal(JOB_SEMANTICS_V2),
  dataset: z.enum(["public", "private"]), scope: JobGraphScopeSchema,
  generation: z.string(), generatedAt: z.string(), sample: JobGraphResultSchema.shape.sample,
  groups: z.array(z.object({ kind: GraphConceptKindSchema, title: z.string(), description: z.string(), items: z.array(GraphItemV2Schema) })),
});
export type GraphV2 = z.infer<typeof GraphV2Schema>;
export const GraphDirectionsSchema = z.object({
  schemaVersion: z.literal("job-directions-v3"),
  items: z.array(z.object({
    family: z.union([JobFamilySchema, z.literal("unclassified")]), label: z.string(), jobCount: z.number().int(),
    children: z.array(z.object({ id: z.string(), label: z.string(), jobCount: z.number().int() })),
  })),
});
export type GraphDirections = z.infer<typeof GraphDirectionsSchema>;
export const GraphEvidenceV2Schema = z.object({ items: z.array(GraphExampleV2Schema), total: z.number().int(), nextOffset: z.number().int().nullable() });
