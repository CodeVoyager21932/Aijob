import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  applyNativeTemplate,
  createNativeResumeDocument,
  ensureNativeResearchSection,
  newNativeItem,
  parseNativeResumeDocument,
} from "@aijob/resume-core";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { renderNativePdfArtifactIsolated } from "../dist/isolated.mjs";

const templates = [
  "studio-banner-cn",
  "studio-index-cn",
  "studio-sidebar-cn",
  "studio-layered-cn",
  "studio-cards-cn",
] as const;
const fontDirectory = resolve("../../apps/web/public/fonts");
let photo = "";
beforeAll(async () => {
  photo = `data:image/png;base64,${(await readFile(resolve("../../apps/web/public/resume-templates/sample-photo.png"))).toString("base64")}`;
});

const expectedText = [
  "中文运营同学",
  "市场运营实习",
  "student@example.com",
  "13800000000",
  "上海",
  "个人作品集",
  "补充作品",
  "关注活动运营与用户调研。",
  "城南学院",
  "本科",
  "市场营销",
  "3.7/4.0",
  "2023年秋—至今",
  "校园服务中心",
  "活动助理",
  "大三暑期",
  "协作负责人",
  "2026年夏",
  "整理活动回访记录。",
  "记录报名流程与复盘报告。",
  "课程调研",
  "调研员",
  "课程小组",
  "访谈与问卷",
  "本学期",
  "访谈材料页",
  "整理需求记录并制作服务建议。",
  "校园消费调查",
  "课程刊物",
  "周同学、林同学",
  "共同作者",
  "已完成",
  "2026年春",
  "Excel",
  "独立完成月度汇总",
  "透视表",
  "公开调研",
  "社区访谈",
  "志愿调研组",
  "记录员",
  "现场观察",
  "寒假期间",
  "完整保留自定义模块的事实。",
];
const expectedLinks = [
  "https://example.com/portfolio",
  "https://example.com/extra",
  "https://example.com/report",
  "https://example.com/interviews",
];

function completeFixture(id: (typeof templates)[number]) {
  const draft = createNativeResumeDocument();
  draft.data.basics = {
    ...draft.data.basics,
    name: "中文运营同学",
    headline: "市场运营实习",
    email: "student@example.com",
    phone: "13800000000",
    location: "上海",
    website: { url: "https://example.com/portfolio", label: "个人作品集" },
    customFields: [
      { id: "extra-link", icon: "", text: "补充作品", link: "https://example.com/extra" },
    ],
  };
  draft.data.picture.url = photo;
  draft.data.picture.hidden = false;
  draft.data.summary.content = "<p>关注活动运营与用户调研。</p><p>原行甲\n原行乙<br>显式行丙</p>";
  draft.data.sections.education.items = [
    {
      ...newNativeItem("education", "education"),
      school: "城南学院",
      degree: "本科",
      area: "市场营销",
      grade: "3.7/4.0",
      period: "2023年秋—至今",
      location: "上海",
    },
  ];
  draft.data.sections.experience.items = [
    {
      ...newNativeItem("experience", "intern"),
      company: "校园服务中心",
      position: "活动助理",
      location: "上海",
      period: "大三暑期",
      roles: [
        {
          id: "role",
          position: "协作负责人",
          period: "2026年夏",
          description: "<p>整理活动回访记录。</p>",
        },
      ],
      description: '<p>记录报名流程与<a href="https://example.com/report">复盘报告</a>。</p>',
    },
  ];
  draft.data.sections.projects.items = [
    {
      ...newNativeItem("projects", "project"),
      name: "课程调研",
      role: "调研员",
      unit: "课程小组",
      method: "访谈与问卷",
      period: "本学期",
      description: "<ul><li>整理需求记录并制作服务建议。</li></ul>",
      website: { url: "https://example.com/interviews", label: "访谈材料页", inlineLink: false },
    },
    { ...newNativeItem("projects", "hidden-project"), name: "隐藏项目不得导出", hidden: true },
  ];
  draft.data.sections.publications.items = [
    {
      ...newNativeItem("publications", "publication"),
      title: "校园消费调查",
      publisher: "课程刊物",
      authors: "周同学、林同学",
      authorPosition: "共同作者",
      status: "已完成",
      date: "2026年春",
    },
  ];
  draft.data.sections.skills.items = [
    {
      ...newNativeItem("skills", "skill"),
      name: "Excel",
      proficiency: "独立完成月度汇总",
      keywords: ["透视表"],
    },
  ];
  draft.data.sections.awards.hidden = true;
  draft.data.sections.awards.items = [
    { ...newNativeItem("awards", "hidden-award"), title: "隐藏模块不得导出" },
  ];
  draft.data.sections.interests.items = [
    { ...newNativeItem("interests", "unplaced-interest"), name: "未放置条目不得导出" },
  ];
  const custom = ensureNativeResearchSection(draft.data, "custom-research");
  custom.title = "公开调研";
  custom.items = [
    {
      ...newNativeItem("projects", "custom-entry"),
      name: "社区访谈",
      unit: "志愿调研组",
      role: "记录员",
      method: "现场观察",
      period: "寒假期间",
      description: "<p>完整保留自定义模块的事实。</p>",
    },
  ];
  const result = applyNativeTemplate(draft, id);
  for (const page of result.data.metadata.layout.pages) {
    page.main = page.main.filter((section) => section !== "interests");
    page.sidebar = page.sidebar.filter((section) => section !== "interests");
  }
  return result;
}

async function inspectPdf(bytes: Uint8Array) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  try {
    const pdf = await task.promise;
    const pages = [];
    const links: string[] = [];
    let imageCount = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const textItems = content.items.filter((item) => "str" in item);
      const operatorList = await page.getOperatorList();
      imageCount += operatorList.fnArray.filter(
        (op) => op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject,
      ).length;
      links.push(
        ...(await page.getAnnotations()).flatMap((annotation) =>
          annotation.url ? [annotation.url] : [],
        ),
      );
      pages.push({
        text: textItems
          .map((item) => item.str)
          .join("")
          .replace(/\s/g, ""),
        width: viewport.width,
        height: viewport.height,
        textPositions: textItems.map((item) => ({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          fontSize: Math.hypot(item.transform[2], item.transform[3]),
        })),
        outsidePaper: textItems
          .filter(
            (item) =>
              item.str.trim() &&
              (item.transform[4] < -1 ||
                item.transform[5] < -1 ||
                item.transform[4] + item.width > viewport.width + 1 ||
                item.transform[5] > viewport.height + 1),
          )
          .map((item) => item.str),
      });
    }
    return { pages, links, imageCount, text: pages.map((page) => page.text).join("") };
  } finally {
    await task.destroy();
  }
}

describe.each(templates)("%s actual PDF contract", (id) => {
  it("retains visible Chinese facts, optional photo, links and custom sections on one A4 page", async () => {
    const draft = completeFixture(id);
    expect(parseNativeResumeDocument(draft)).toEqual(draft);
    const before = structuredClone(draft);
    const artifact = await renderNativePdfArtifactIsolated(draft, fontDirectory);
    const actual = await inspectPdf(artifact.bytes);
    expect(actual.pages).toHaveLength(1);
    expect(artifact.fit?.pageCount).toBe(actual.pages.length);
    expect(artifact.fit?.overflowItemIds).toEqual([]);
    expect(artifact.fit?.bodyFontSize).toBe(draft.data.metadata.typography.body.fontSize);
    expect(artifact.diagnostics).toEqual([]);
    expect(actual.pages[0]?.width).toBeCloseTo(595.28, 1);
    expect(actual.pages[0]?.height).toBeCloseTo(841.89, 1);
    expect(actual.pages.flatMap((page) => page.outsidePaper)).toEqual([]);
    for (const fact of expectedText) expect(actual.text, `Missing fact: ${fact}`).toContain(fact);
    for (const link of expectedLinks) expect(actual.links).toContain(link);
    const positions = actual.pages.flatMap((page) => page.textPositions);
    expect(positions.find((item) => item.text.includes("关注活动"))?.fontSize).toBeCloseTo(11, 1);
    const baseline = (token: string) => {
      const item = positions.find((item) => item.text.includes(token));
      if (!item) throw new Error(`Missing line-break fixture token: ${token}`);
      return item.y;
    };
    expect(baseline("原行甲")).toBeCloseTo(baseline("原行乙"), 1);
    expect(baseline("显式行丙")).toBeLessThan(baseline("原行乙") - 5);
    expect(actual.imageCount).toBeGreaterThan(0);
    const anchors = artifact.anchors.map((anchor) => anchor.id);
    for (const visible of [
      "education",
      "intern",
      "project",
      "publication",
      "skill",
      "custom-entry",
    ])
      expect(anchors).toContain(visible);
    for (const hidden of ["隐藏项目不得导出", "隐藏模块不得导出", "未放置条目不得导出"])
      expect(actual.text).not.toContain(hidden);
    for (const hidden of ["hidden-project", "hidden-award", "unplaced-interest"])
      expect(anchors).not.toContain(hidden);
    expect(draft).toEqual(before);
  }, 60000);

  it("reports long-content overflow without cropping the final item or reducing the chosen font size", async () => {
    const draft = applyNativeTemplate(createNativeResumeDocument(), id);
    draft.data.basics.name = "长材料同学";
    draft.data.picture.url = photo;
    draft.data.picture.hidden = true;
    draft.data.sections.projects.items = Array.from({ length: 28 }, (_, index) => ({
      ...newNativeItem("projects", `long-${index}`),
      name: `保留任务${index}`,
      description: `<p>这是一段必须完整保留的中文经历说明，记录调研背景、个人职责、协作过程和实际结果；超出单页容量时仍然保留全部文字。第${index}条完整结束。</p>`,
    }));
    const before = structuredClone(draft);
    const artifact = await renderNativePdfArtifactIsolated(draft, fontDirectory);
    const actual = await inspectPdf(artifact.bytes);
    expect(artifact.fit?.level).toBe(2);
    expect(artifact.fit?.bodyFontSize).toBe(draft.data.metadata.typography.body.fontSize);
    expect(actual.pages.length).toBeGreaterThan(1);
    expect(artifact.fit?.pageCount).toBe(actual.pages.length);
    expect(artifact.fit?.overflowItemIds.length).toBeGreaterThan(0);
    expect(artifact.fit?.overflowItemIds).toContain("long-27");
    expect(artifact.anchors.some((anchor) => anchor.id === "long-27" && anchor.page > 1)).toBe(
      true,
    );
    for (let index = 0; index < 28; index++) {
      expect(actual.text).toContain(`保留任务${index}`);
      expect(actual.text).toContain(`第${index}条完整结束。`);
    }
    expect(actual.pages.at(-1)?.text).toContain("第27条完整结束。");
    expect(actual.pages.flatMap((page) => page.outsidePaper)).toEqual([]);
    expect(actual.imageCount).toBe(0);
    expect(artifact.diagnostics).toEqual([]);
    expect(draft).toEqual(before);
  }, 60000);
});
