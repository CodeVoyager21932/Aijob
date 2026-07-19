import { z } from "zod";
import { OpenAiCompatibleProvider, type OpenAiCompatibleProviderConfig } from "./provider.js";

const REQUIREMENT_ID = "synthetic-requirement-product-research";
const EVIDENCE_ID = "synthetic-evidence-course-project";

const SmokeOutputSchema = z.object({
  selections: z
    .array(
      z.object({
        evidenceId: z.literal(EVIDENCE_ID),
        requirementIds: z.array(z.literal(REQUIREMENT_ID)).min(1).max(1),
        emphasis: z
          .array(z.enum(["claim", "skills", "outcomes"]))
          .min(1)
          .max(3),
      }),
    )
    .min(1)
    .max(1),
});

export async function runAiProviderSmoke(
  config: OpenAiCompatibleProviderConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: "passed"; selectionCount: number }> {
  const provider = new OpenAiCompatibleProvider(config, fetchImpl);
  const output = await provider.completeStructured({
    systemInstruction:
      "你是简历证据编排器。只能从输入中选择证据 ID、岗位要求 ID 和强调维度，" +
      "不得补写经历、数字、技能或结果。返回 JSON 对象。",
    untrustedPayload: {
      requirements: [
        {
          id: REQUIREMENT_ID,
          kind: "experience",
          sourceText: "能够基于用户反馈整理产品需求",
        },
      ],
      confirmedEvidence: [
        {
          id: EVIDENCE_ID,
          section: "课程项目",
          claim: "整理访谈记录并形成需求清单",
          skills: ["用户访谈", "需求整理"],
          outcomes: ["形成课程项目需求清单"],
          confirmed: true,
        },
      ],
    },
    schema: SmokeOutputSchema,
  });
  return { status: "passed", selectionCount: output.selections.length };
}
