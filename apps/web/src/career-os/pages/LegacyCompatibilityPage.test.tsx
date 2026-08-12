import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { LegacyCompatibilityPage } from "./LegacyCompatibilityPage";

describe("legacy compatibility page", () => {
  it.each([
    ["recommendations", "旧推荐页不再生成新的独立推荐记录"],
    ["insights", "旧洞察页不再生成脱离岗位上下文的分析"],
  ] as const)("renders a request-free %s handoff", (surface, expectedCopy) => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LegacyCompatibilityPage surface={surface} />
      </MemoryRouter>,
    );

    expect(html).toContain(expectedCopy);
    expect(html).toContain('href="/jobs"');
    expect(html).toContain('href="/applications"');
    expect(html).not.toContain("生成推荐");
    expect(html).not.toContain("开始洞察");
  });
});
