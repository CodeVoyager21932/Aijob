import { readFile } from "node:fs/promises";
import { z } from "zod";
import { getRepositoryRoot } from "./source-config.js";

const sourceCandidateSchema = z.object({
  companyKey: z.string().regex(/^[a-z0-9-]+$/),
  displayName: z.string().trim().min(1),
  assessmentStatus: z.enum(["configured_pending_review", "not_assessed", "paused", "rejected"]),
  sourceKeys: z.array(z.string().regex(/^[a-z0-9-]+$/)),
});

const sourceCandidateRegistrySchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    scope: z.literal("local_all_function_internships"),
    evidenceLevel: z.literal("E0"),
    targetActiveJobs: z.object({
      minimum: z.number().int().min(100),
      maximum: z.number().int().max(200),
    }),
    liveProbeRequiresExplicitApproval: z.literal(true),
    priorityBatch: z.array(sourceCandidateSchema).length(12),
    reserveBatch: z.array(sourceCandidateSchema).min(1),
  })
  .superRefine((registry, context) => {
    if (registry.targetActiveJobs.minimum > registry.targetActiveJobs.maximum) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "invalid targetActiveJobs range" });
    }
    const keys = [...registry.priorityBatch, ...registry.reserveBatch].map(
      (candidate) => candidate.companyKey,
    );
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate companyKey" });
    }
  });

export type SourceCandidateRegistry = z.infer<typeof sourceCandidateRegistrySchema>;

export async function loadSourceCandidateRegistry(): Promise<SourceCandidateRegistry> {
  const contents = await readFile(`${getRepositoryRoot()}/config/source-candidates.json`, "utf8");
  return sourceCandidateRegistrySchema.parse(JSON.parse(contents));
}
