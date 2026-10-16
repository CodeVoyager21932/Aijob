import { describe, expect, it } from "vitest";
import {
  applyNativeTemplate,
  createNativeResumeDocument,
  joinNativeResumeDocument,
  parseNativeResumeDocument,
  singlePageLayout,
  splitNativeResumeDocument,
} from "./index.js";

describe("field-scoped presentation persistence", () => {
  it("round trips through stored layout without changing or duplicating content", () => {
    const draft = applyNativeTemplate(createNativeResumeDocument(), "studio-sidebar-cn");
    draft.data.basics.headline = "小学教育 · 教研与阅读活动助理";
    draft.data.basics.email = "shuning.zhou@example.com";
    const originalContent = splitNativeResumeDocument(draft).content;
    draft.fieldLayout = {
      headline: { fontSize: 11.5, lineMode: "manual", breakAfter: 7, position: "main" },
      email: { fontSize: 10.5, lineMode: "single", position: "main" },
    };
    const stored = splitNativeResumeDocument(draft);
    expect(stored.content).toEqual(originalContent);
    expect(stored.layout.fieldLayout).toEqual(draft.fieldLayout);
    expect(joinNativeResumeDocument(stored.content, stored.layout)).toEqual(draft);
    for (const level of [0, 1, 2])
      expect(singlePageLayout(draft, level).fieldLayout).toEqual(draft.fieldLayout);
  });

  it("keeps old layouts unchanged and allows reverting only one field", () => {
    const draft = createNativeResumeDocument();
    const stored = splitNativeResumeDocument(draft);
    expect(joinNativeResumeDocument(stored.content, stored.layout)).toEqual(draft);
    expect(stored.layout).not.toHaveProperty("fieldLayout");
    draft.fieldLayout = { headline: { fontSize: 12 }, email: { position: "main" } };
    delete draft.fieldLayout.headline;
    expect(parseNativeResumeDocument(draft).fieldLayout).toEqual({ email: { position: "main" } });
  });

  it.each([
    { email: { fontSize: 6 } },
    { email: { fontSize: 10.2 } },
    { headline: { position: "absolute" } },
    { headline: { breakAfter: -1 } },
    { email: { hidden: true } },
    { unrelatedField: { fontSize: 10 } },
  ])("rejects invalid or unmodelled overrides instead of discarding them", (fieldLayout) => {
    expect(() =>
      parseNativeResumeDocument({ ...createNativeResumeDocument(), fieldLayout }),
    ).toThrow();
  });
});
