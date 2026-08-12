import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AssetDeletionDialog,
  caseDeletionChoicesComplete,
  CaseDeletionDialog,
} from "./AssetDeletionDialog";

describe("Career asset deletion confirmation", () => {
  it("requires an explicit decision for all three Case asset groups", () => {
    expect(
      caseDeletionChoicesComplete({
        resumeDocuments: "delete",
        interviewSessions: null,
        debriefs: "detach",
      }),
    ).toBe(false);
    expect(
      caseDeletionChoicesComplete({
        resumeDocuments: "delete",
        interviewSessions: "detach",
        debriefs: "detach",
      }),
    ).toBe(true);

    const html = renderToStaticMarkup(
      <CaseDeletionDialog
        open
        privateJob
        pending={false}
        error={null}
        onClose={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(html).toContain("分别决定关联资产如何处理");
    expect(html).toContain("岗位简历");
    expect(html).toContain("面试练习");
    expect(html).toContain("复盘");
    expect(html).toContain("请完成三项选择");
    expect(html).toContain("disabled");
  });

  it("states the consequence of a single-asset deletion", () => {
    const html = renderToStaticMarkup(
      <AssetDeletionDialog
        open
        title="删除这轮面试练习？"
        description="只删除当前选择的练习。"
        consequence="关联复盘不会自动删除。"
        pending={false}
        error={null}
        onClose={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(html).toContain("只删除当前选择的练习");
    expect(html).toContain("关联复盘不会自动删除");
    expect(html).toContain("确认删除");
  });
});
