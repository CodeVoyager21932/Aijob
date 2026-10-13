import { describe, expect, it } from "vitest";
import {
  ConfiguredWebOptionsSchema,
  normalizeConfiguredDetail,
  parseConfiguredList,
} from "./configured-web-adapter.js";

const webFixtureOptions = ConfiguredWebOptionsSchema.parse({
  configurationVersion: "fixture-1",
  render: false,
  list: {
    row: ".job",
    detailLink: "a",
    nextLink: ".next",
    terminalMarker: "[data-end]",
    emptyMarker: ".empty",
  },
  detail: {
    title: "h1",
    responsibilities: ".duties",
    requirements: ".requirements",
    applyLink: ".apply",
  },
});

describe("configured official HTML pipeline", () => {
  it("requires an explicit end marker and resolves pagination deterministically", () => {
    const page = parseConfiguredList(
      '<div class="job"><a href="/jobs/1">岗位</a></div><a class="next" href="?page=2">下一页</a>',
      "https://example.test/jobs",
      webFixtureOptions,
    );
    expect(page).toMatchObject({
      links: ["https://example.test/jobs/1"],
      nextUrl: "https://example.test/jobs?page=2",
      terminal: false,
    });
    expect(() =>
      parseConfiguredList(
        '<div class="job"><a href="/jobs/1">岗位</a></div>',
        "https://example.test/jobs",
        webFixtureOptions,
      ),
    ).toThrow("PAGINATION_AMBIGUOUS");
  });
  it("does not interpret a changed/empty page as the end of a complete list", () => {
    expect(() =>
      parseConfiguredList(
        "<main data-end>页面加载失败</main>",
        "https://example.test/jobs",
        webFixtureOptions,
      ),
    ).toThrow("UNEXPECTED_EMPTY");
    expect(
      parseConfiguredList(
        '<main class="empty" data-end>暂无岗位</main>',
        "https://example.test/jobs",
        webFixtureOptions,
      ),
    ).toMatchObject({ explicitEmpty: true, terminal: true });
  });
  it("preserves official sentences and semantic hashes across refreshes", () => {
    const input = {
      url: "https://example.test/jobs/1",
      html: '<h1>产品运营实习生</h1><p class="requirements">本科、硕士或博士在读</p><a class="apply" href="/apply/1">投递</a>',
      companyName: "夹具公司",
      options: webFixtureOptions,
    };
    const first = normalizeConfiguredDetail({ ...input, evidenceRef: "fetch-1" });
    const second = normalizeConfiguredDetail({ ...input, evidenceRef: "fetch-2" });
    expect(first.requirements).toBe("本科、硕士或博士在读");
    expect(first.revisionContentHash).toBe(second.revisionContentHash);
    expect(first.locations.state).toBe("unknown");
    expect(first.jobFamily).toMatchObject({ state: "known", value: "operations" });
    expect(first.applicationLinkKind).toBe("exact");
  });
  it("retains a local draft when the official application entrance is absent", () => {
    const result = normalizeConfiguredDetail({
      url: "https://example.test/jobs/1",
      html: '<h1>行政实习</h1><p class="duties">整理办公资料</p>',
      companyName: "夹具公司",
      options: webFixtureOptions,
      evidenceRef: "fetch-1",
    });
    expect(result.applicationLinkKind).toBe("missing");
    expect(result.reviewReasons[0]?.code).toBe("OFFICIAL_APPLY_URL_MISSING");
  });
});
