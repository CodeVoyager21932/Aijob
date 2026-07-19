import { expect, it, vi } from "vitest";
import { runAiProviderSmoke } from "./smoke.js";

const config = {
  enabled: true,
  baseUrl: "https://provider.example/v1",
  model: "example-model",
  apiKey: "synthetic-secret",
  requestTimeoutMs: 1_000,
} as const;

it("uses only fixed synthetic references for the provider smoke", async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                selections: [
                  {
                    evidenceId: "synthetic-evidence-course-project",
                    requirementIds: ["synthetic-requirement-product-research"],
                    emphasis: ["claim"],
                  },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );

  await expect(runAiProviderSmoke(config, fetchImpl)).resolves.toEqual({
    status: "passed",
    selectionCount: 1,
  });
  const requestBody = String(fetchImpl.mock.calls[0]?.[1]?.body);
  expect(requestBody).not.toContain(config.apiKey);
  expect(JSON.parse(requestBody)).not.toHaveProperty("tools");
});

it("rejects provider references outside the synthetic allowlist", async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                selections: [
                  {
                    evidenceId: "invented-evidence",
                    requirementIds: ["synthetic-requirement-product-research"],
                    emphasis: ["claim"],
                  },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200 },
    ),
  );

  await expect(runAiProviderSmoke(config, fetchImpl)).rejects.toMatchObject({
    code: "AI_RESPONSE_INVALID",
  });
});
