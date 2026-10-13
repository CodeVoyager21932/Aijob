import { describe, expect, it } from "vitest";
import {
  executeSearch,
  parseSearchResponse,
  responsesEndpoint,
  selectSearchAdapter,
} from "./search-adapters.js";
import { discoveryQueries } from "./subscriptions.js";

const source = { url: "https://careers.example.com/jobs?utm_source=x", title: "官方招聘" };
describe("search connection evidence", () => {
  it("uses tool sources, discards answer text and normalizes URLs", () => {
    const result = parseSearchResponse(
      {
        output: [
          {
            type: "web_search_call",
            status: "completed",
            action: {
              sources: [
                source,
                { ...source, url: "https://careers.example.com/jobs" },
                { url: "https://127.0.0.1/" },
              ],
            },
          },
          {
            type: "message",
            content: [{ type: "output_text", text: "FAKE https://invented.example/" }],
          },
        ],
        usage: { input_tokens: 40, output_tokens: 12 },
      },
      "openai-responses",
    );
    expect(result).toEqual({
      leads: [{ url: "https://careers.example.com/jobs", title: "官方招聘" }],
      toolCalls: 1,
      modelTokens: 52,
    });
  });
  it("does not count ignored tools, answer URLs, or ungrounded annotations as search capability", () => {
    for (const body of [
      { output_text: "我联网搜索过了 https://example.com" },
      { choices: [{ message: { content: "https://example.com" } }] },
      ...[undefined, "queued", "in_progress", "failed"].map((status) => ({
        output: [{ type: "web_search_call", status, action: { sources: [source] } }],
      })),
      {
        output: [
          { type: "message", content: [{ annotations: [{ type: "url_citation", ...source }] }] },
        ],
      },
    ])
      expect(() => parseSearchResponse(body, "openai-responses")).toThrow(
        "SEARCH_TOOL_NOT_OBSERVED",
      );
    expect(() =>
      parseSearchResponse(
        { output: [{ type: "web_search_call", status: "completed", action: {} }] },
        "openai-responses",
      ),
    ).toThrow("SEARCH_SOURCES_MISSING");
  });
  it("understands provider tool counts without inventing model usage", () => {
    expect(
      parseSearchResponse(
        {
          output: [{ type: "web_search_call", status: "completed", action: { sources: [source] } }],
          usage: { x_tools: { web_search: { count: 3 } } },
        },
        "bailian-responses",
      ),
    ).toMatchObject({ toolCalls: 3, modelTokens: null });
    expect(
      parseSearchResponse(
        {
          output: [
            { type: "message", content: [{ annotations: [{ type: "url_citation", ...source }] }] },
          ],
          usage: { server_tool_use: { web_search_requests: 2 } },
        },
        "openrouter",
      ),
    ).toMatchObject({ toolCalls: 2, modelTokens: null });
  });
  it("probes a relay only at its own responses endpoint with a bounded tool request", async () => {
    let captured: unknown;
    await executeSearch({
      query: "产品实习 上海 招聘 官网",
      apiKey: "fixture-secret",
      adapter: "openrouter",
      baseUrl: "https://relay.example/v1/chat/completions",
      model: "test",
      fetchImpl: async (url, init) => {
        captured = { url, body: JSON.parse(String(init?.body)) };
        return Response.json({
          output: [{ type: "web_search_call", status: "completed", action: { sources: [source] } }],
        });
      },
    });
    expect(captured).toMatchObject({
      url: "https://relay.example/v1/responses",
      body: {
        max_tool_calls: 1,
        tools: [
          { type: "openrouter:web_search", parameters: { max_uses: 1, max_total_results: 10 } },
        ],
      },
    });
    expect(responsesEndpoint("https://provider.example/v1/responses")).toBe(
      "https://provider.example/v1/responses",
    );
    expect(selectSearchAdapter("https://relay.example/v1", "auto")).toBe("openai-responses");
  });
  it("separates unsupported protocol from authentication or temporary network failures", async () => {
    for (const [status, capability] of [
      [400, "unsupported"],
      [401, "temporary_failure"],
      [429, "temporary_failure"],
      [503, "temporary_failure"],
    ] as const) {
      await expect(
        executeSearch({
          query: "公开招聘",
          apiKey: "fixture",
          adapter: "openai-responses",
          baseUrl: "https://relay.example/v1",
          model: "test",
          fetchImpl: async () => new Response("private provider error", { status }),
        }),
      ).rejects.toMatchObject({ capability });
    }
  });
  it("rotates requested cities without adding other recruitment types or private material", () => {
    const queries = discoveryQueries({
      __catalogQuery: { keyword: "产品实习", jobFamilies: ["product"], cities: ["上海", "杭州"] },
      resume: "PRIVATE",
    });
    expect(queries.map((q) => q.text)).toEqual([
      "产品实习 上海 招聘 官网",
      "产品实习 杭州 招聘 官网",
    ]);
    expect(queries[0]!.hash).not.toBe(queries[1]!.hash);
  });
});
