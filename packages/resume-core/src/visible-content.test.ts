import { expect, it } from "vitest";
import {
  createNativeResumeDocument,
  hasNativeResumeContent,
  hasVisibleNativeResumeContent,
  newNativeItem,
} from "./index.js";

it("distinguishes a retained blank row from text that can appear on the paper", () => {
  const document = createNativeResumeDocument();
  document.data.sections.experience.items.push(newNativeItem("experience", "blank-row"));
  document.data.summary.content = "<p><br>&nbsp;</p>";
  expect(hasNativeResumeContent(document)).toBe(true);
  expect(hasVisibleNativeResumeContent(document)).toBe(false);
  const row = document.data.sections.experience.items[0];
  if (!row) throw new Error("Fixture row missing");
  row.company = "校园服务中心";
  expect(hasVisibleNativeResumeContent(document)).toBe(true);
});

it("does not call hidden or unplaced work visible content", () => {
  const document = createNativeResumeDocument();
  document.data.sections.projects.items.push({
    ...newNativeItem("projects", "hidden"),
    hidden: true,
    name: "保留的隐藏项目",
  });
  document.data.sections.experience.items.push({
    ...newNativeItem("experience", "unplaced"),
    company: "保留的实习",
  });
  document.data.metadata.layout.pages = [{ fullWidth: true, main: ["projects"], sidebar: [] }];
  expect(hasNativeResumeContent(document)).toBe(true);
  expect(hasVisibleNativeResumeContent(document)).toBe(false);
  document.data.basics.email = "student@example.com";
  expect(hasVisibleNativeResumeContent(document)).toBe(true);
});
