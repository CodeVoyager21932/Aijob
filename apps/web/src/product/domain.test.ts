import { describe, expect, it } from "vitest";
import {
  detectBrowserPii,
  displayField,
  preferenceStatusLabel,
  preferenceStatusTone,
  splitList,
} from "./domain";

describe("formal product domain presentation", () => {
  it("never presents an unknown field as matching", () => {
    expect(
      displayField<number>({
        state: "unknown",
        reason: "source_not_stated",
      }),
    ).toEqual({
      text: "未说明",
      state: "unknown",
      note: "当前企业官网或官方 ATS 没有明确说明，不能当作符合。",
    });
  });

  it("finds common identifiers in the browser before submission", () => {
    expect(
      detectBrowserPii("电话 13812345678，邮箱 coco@example.com，身份证 110105199001011234。"),
    ).toEqual([
      { kind: "phone", count: 1 },
      { kind: "email", count: 1 },
      { kind: "national_id", count: 1 },
    ]);
  });

  it("normalizes comma and newline separated preferences", () => {
    expect(splitList("深圳， 广州\n上海、北京；杭州;成都")).toEqual([
      "深圳",
      "广州",
      "上海",
      "北京",
      "杭州",
      "成都",
    ]);
  });

  it("distinguishes an unset preference from a configured preference blocked by unknown job data", () => {
    expect(preferenceStatusLabel("not_set", [])).toBe("未设置");
    expect(preferenceStatusLabel("not_set", ["WORK_MODE_PREFERENCE_UNKNOWN"])).toBe(
      "岗位信息待核对",
    );
    expect(preferenceStatusTone("not_set", ["WORK_MODE_PREFERENCE_UNKNOWN"])).toBe("warning");
  });
});
