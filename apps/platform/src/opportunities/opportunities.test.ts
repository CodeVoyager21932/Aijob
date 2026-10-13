import { describe, it, expect, vi } from "vitest";
import { normalizeLeadUrl, searchTavily } from "./discovery.js";
import { discoveryQuery, nextDigestTime } from "./subscriptions.js";
import { classifyDigestChange } from "./digests.js";
import { buildLeadProposal } from "./source-leads.js";
import { parseSourceConfigValue } from "../sources/source-config.js";

describe("opportunity discovery boundaries", () => {
  it("only sends the basic search request and retains deduplicated link metadata", async () => {
    const mocked = vi.fn(
      async (_url: unknown, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            results: [
              {
                url: "https://careers.example.com/jobs?utm_source=x&id=2",
                title: "岗位",
                content: "DO NOT RETAIN SEARCH CONTENT",
              },
              { url: "https://careers.example.com/jobs?id=2", title: "岗位" },
              { url: "http://127.0.0.1/", title: "private" },
            ],
          }),
          { status: 200 },
        ),
    );
    const leads = await searchTavily({
      query: "上海 数据分析 校招",
      apiKey: "fixture-only",
      fetchImpl: mocked as typeof fetch,
    });
    expect(leads).toEqual([{ url: "https://careers.example.com/jobs?id=2", title: "岗位" }]);
    expect(mocked).toHaveBeenCalledTimes(1);
    const init = mocked.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
      auto_parameters: false,
    });
    expect(init?.redirect).toBe("error");
    expect(normalizeLeadUrl("https://user:pass@company.example/")).toBeNull();
    expect(normalizeLeadUrl("https://127.0.0.1/")).toBeNull();
  });
  it("shares identical non-personal direction queries and schedules the next Shanghai morning", () => {
    expect(discoveryQuery({ __catalogQuery: { keyword: " 数据分析 ", cities: ["上海"] } })).toEqual(
      discoveryQuery({ __catalogQuery: { keyword: "数据分析", cities: ["上海"] } }),
    );
    expect(nextDigestTime(new Date("2026-10-12T01:00:00Z"), "09:00").toISOString()).toBe(
      "2026-10-13T01:00:00.000Z",
    );
  });
  it("distinguishes initial inventory, unchanged content and authoritative closure", () => {
    const row = {
      job_id: "j",
      version_id: "v",
      activity_state: "active",
      title: "职位",
      company_name: "企业",
    };
    expect(classifyDigestChange(row, undefined, true)).toBe("initial");
    expect(classifyDigestChange(row, row)).toBe("unchanged");
    expect(classifyDigestChange({ ...row, version_id: "v2" }, row)).toBe("updated");
    expect(classifyDigestChange({ ...row, activity_state: "closed" }, row)).toBe("closed");
  });
  it("builds a disabled unverified draft using the existing configuration contract", () => {
    const proposal = buildLeadProposal(
      {
        sourceKey: "fixture-new-company",
        companyName: "待核验企业",
        officialUrl: "https://careers.example.com/jobs",
      },
      "https://university.example.com/post",
    );
    const config = parseSourceConfigValue(proposal.configuration);
    expect(config.policy.crawlInterval.enabled).toBe(false);
    expect(config.candidate.provenanceLevel).toBe("unverified");
    expect(config.candidate.hardGates.officialIdentity).toBe("pending");
    expect(config.catalogRole).toBe("discovery_only");
    expect(() =>
      buildLeadProposal(
        {
          sourceKey: "bad-company",
          companyName: "平台",
          officialUrl: "https://www.zhipin.com/job",
        },
        "https://example.com",
      ),
    ).toThrow("DISCOVERY_PLATFORM_NOT_A_SOURCE");
  });
});
