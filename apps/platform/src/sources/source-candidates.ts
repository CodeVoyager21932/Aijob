import { readFile } from "node:fs/promises";
import { z } from "zod";
import { getRepositoryRoot } from "./source-config.js";

const sourceCandidateSchema = z.object({
  companyKey: z.string().regex(/^[a-z0-9-]+$/),
  displayName: z.string().trim().min(1),
  assessmentStatus: z.enum(["configured_pending_review", "not_assessed", "paused", "rejected"]),
  sourceKeys: z.array(z.string().regex(/^[a-z0-9-]+$/)),
  scaleBand: z.enum(["small", "medium", "large", "unknown"]),
  scaleEvidenceRef: z.string().trim().min(1).nullable(),
});

const sourceCandidateRegistrySchema = z
  .object({
    schemaVersion: z.literal("2.0.0"),
    scope: z.literal("local_all_function_internships"),
    evidenceLevel: z.literal("E0"),
    targets: z.object({
      visibleJobs: z.object({
        minimum: z.number().int().min(300),
        maximum: z.number().int().max(500),
      }),
      companies: z.object({
        minimum: z.number().int().min(30),
        maximum: z.number().int().max(40),
      }),
      minimumSmeCompanyRatio: z.number().min(0).max(1),
      minimumSmeVisibleJobRatio: z.number().min(0).max(1),
    }),
    batchPolicy: z.object({
      maxCompanies: z.literal(5),
      initialJobsPerCompany: z.literal(5),
    }),
    liveProbeRequiresExplicitApproval: z.literal(true),
    priorityBatch: z.array(sourceCandidateSchema).max(5),
    reserveBatch: z.array(sourceCandidateSchema).min(1),
  })
  .superRefine((registry, context) => {
    if (registry.targets.visibleJobs.minimum > registry.targets.visibleJobs.maximum) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "invalid visibleJobs range" });
    }
    if (registry.targets.companies.minimum > registry.targets.companies.maximum) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "invalid companies range" });
    }
    const keys = [...registry.priorityBatch, ...registry.reserveBatch].map(
      (candidate) => candidate.companyKey,
    );
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate companyKey" });
    }
    for (const candidate of [...registry.priorityBatch, ...registry.reserveBatch]) {
      if (
        candidate.scaleBand !== "unknown" &&
        candidate.scaleEvidenceRef === null
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `missing scale evidence for ${candidate.companyKey}`,
        });
      }
      if (candidate.assessmentStatus === "not_assessed" && candidate.sourceKeys.length > 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unassessed candidate cannot have source keys: ${candidate.companyKey}`,
        });
      }
    }
  });

export type SourceCandidateRegistry = z.infer<typeof sourceCandidateRegistrySchema>;

export async function loadSourceCandidateRegistry(): Promise<SourceCandidateRegistry> {
  const contents = await readFile(`${getRepositoryRoot()}/config/source-candidates.json`, "utf8");
  return sourceCandidateRegistrySchema.parse(JSON.parse(contents));
}
