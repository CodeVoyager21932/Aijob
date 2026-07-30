import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { normalizeNankaiTalRole, parseNankaiTalPage } from "./nankai-tal-2027-adapter.js";

async function htmlFixture(): Promise<string> {
  const url = new URL(
    "../../../../fixtures/ingestion/nankai-tal-2027.synthetic.html",
    import.meta.url,
  );
  return readFile(url, "utf8");
}

describe("Nankai TAL 2027 adapter", () => {
  it("extracts exactly the seven operations roles and the shared official facts", async () => {
    const page = parseNankaiTalPage(await htmlFixture());

    expect(page.roles).toEqual([
      "商业化运营",
      "直播运营",
      "电商运营",
      "达人直播运营",
      "活动新媒体运营",
      "招生增长运营（ToB方向）",
      "学科产品运营",
    ]);
    expect(page.audienceText).toContain("2027届及以后");
    expect(page.requirementText).toContain("每周 出勤 4天");
    expect(page.applyUrl).toContain("app.mokahr.com/campus-recruitment/tal/95443");

    const normalized = normalizeNankaiTalRole({
      role: page.roles[0] ?? "",
      page,
      pageEvidenceRef: "page-fetch",
    });
    expect(normalized.companyName).toBe("好未来");
    expect(normalized.jobFamily).toMatchObject({ state: "known", value: "operations" });
    expect(normalized.structuredFields.weeklyAttendanceDays).toMatchObject({
      state: "known",
      value: 4,
    });
    expect(normalized.structuredFields.durationMonths).toMatchObject({
      state: "known",
      value: 2,
    });
    expect(normalized.structuredFields.graduationYears).toMatchObject({
      state: "known",
      value: [2027],
    });
    expect(normalized.requirements).toContain("2027届及以后");
    expect(normalized.responsibilities).toBe("");
    expect(normalized.reviewReasons.map((reason) => reason.code)).toContain(
      "ROLE_LEVEL_DUTIES_NOT_STATED",
    );
  });

  it("fails closed when the target section or official apply link disappears", async () => {
    const html = await htmlFixture();
    expect(() => parseNankaiTalPage(html.replace("运营类", "其他类"))).toThrow(
      "NANKAI_TAL_OPERATIONS_SECTION_MISSING",
    );
    expect(() => parseNankaiTalPage(html.replace("app.mokahr.com", "example.invalid"))).toThrow(
      "NANKAI_TAL_OFFICIAL_APPLY_LINK_MISSING",
    );
  });
});
