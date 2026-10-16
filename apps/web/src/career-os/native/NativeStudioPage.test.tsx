import { createNativeResumeDocument } from "@aijob/resume-core";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NativeStudioPage } from "./NativeStudioPage";

const harness = vi.hoisted(() => ({
  documentId: "draft-next",
  draft: null as unknown,
  recovery: null as unknown,
  seedDraft: false,
  seedRecovery: false,
}));

// Deliberately retain a prior route's loader state. Effects do not run in this
// render, reproducing the interval before a route-change reset effect can act.
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: ((initial: unknown) => {
      const state = react.useState(initial);
      if (initial === null && harness.seedDraft) {
        harness.seedDraft = false;
        return [harness.draft, state[1]];
      }
      if (initial === null && harness.seedRecovery) {
        harness.seedRecovery = false;
        return [harness.recovery, state[1]];
      }
      return state;
    }) as typeof react.useState,
  };
});
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useParams: () => ({ documentId: harness.documentId }),
}));
vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  currentWorkspaceOwnerKey: () => "fixture-owner",
}));
vi.mock("./NativeAssistant", () => ({ NativeAssistant: () => null }));
vi.mock("./NativeContentEditor", () => ({ NativeContentEditor: () => null }));
vi.mock("./NativePdfPreview", () => ({ NativePdfPreview: () => null }));
vi.mock("./NativeRecoveryContent", () => ({ NativeRecoveryContent: () => null }));

function draft(documentId: string, title: string) {
  return {
    documentId,
    title,
    revision: 3,
    document: createNativeResumeDocument(),
    updatedAt: "2026-10-15T10:00:00Z",
  };
}
function renderPage(value: ReturnType<typeof draft>, recovery: unknown = null) {
  harness.draft = value;
  harness.recovery = recovery;
  harness.seedDraft = true;
  harness.seedRecovery = true;
  return renderToStaticMarkup(
    <MemoryRouter>
      <NativeStudioPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  harness.documentId = "draft-next";
  harness.seedDraft = false;
  harness.seedRecovery = false;
});

describe("native editor document-route isolation", () => {
  it("replaces the entire loading and recovery session when the route changes", () => {
    harness.documentId = "draft-old";
    const previous = NativeStudioPage();
    harness.documentId = "draft-next";
    const next = NativeStudioPage();
    expect(previous.key).not.toBe(next.key);
    expect(previous.props.documentId).toBe("draft-old");
    expect(next.props.documentId).toBe("draft-next");
  });

  it("does not expose the old editable draft while the next route is still loading", () => {
    const html = renderPage(draft("draft-old", "旧稿不可在新地址编辑"));
    expect(html).toContain("正在打开简历");
    expect(html).not.toContain('aria-label="稿件名称"');
    expect(html).not.toContain("旧稿不可在新地址编辑");
  });

  it("does not offer an old document's recovery under a new route", () => {
    const old = draft("draft-old", "旧服务器稿");
    const html = renderPage(old, {
      baseRevision: 3,
      title: "旧稿未保存的名称",
      document: old.document,
    });
    expect(html).toContain("正在打开简历");
    expect(html).not.toContain("恢复本机草稿并继续");
    expect(html).not.toContain('aria-label="稿件名称"');
  });

  it("opens the matching draft once that route's data has arrived", () => {
    const html = renderPage(draft("draft-next", "新稿的服务器名称"));
    expect(html).toContain('aria-label="稿件名称"');
    expect(html).toContain('value="新稿的服务器名称"');
    expect(html).not.toContain("正在打开简历");
  });
});
