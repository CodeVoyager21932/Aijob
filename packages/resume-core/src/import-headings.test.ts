import { describe, expect, it } from "vitest";
import { nativeImportHeadingKind } from "./import-headings.js";

describe("public PDF section-heading variants", () => {
  it("recognizes a single extracted icon glyph and a certification heading", () => {
    expect(nativeImportHeadingKind("Ÿ 工作经历")).toBe("experience");
    expect(nativeImportHeadingKind("ŵ 教育")).toBe("education");
    expect(nativeImportHeadingKind("Þ 认证证书")).toBe("certifications");
  });

  it("does not treat an ordinary sentence containing a heading as a title", () => {
    expect(nativeImportHeadingKind("教育背景是我申请岗位的依据")).toBeUndefined();
    expect(nativeImportHeadingKind("教育背景 北京理工大学")).toBeUndefined();
  });
});
