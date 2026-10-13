import { randomUUID } from "node:crypto";
import {
  blankResumeEntry,
  blankResumeStudioContent,
  resumeRichPlain,
  resumeRichText,
  resumeEntryDetails,
  resumeEntryHasContent,
  hasRenderableResumeEntry,
  type ResumeSemanticContent,
  type ResumeStudioContent,
  type ResumeStudioEntry,
  type ResumeSectionKind,
} from "@aijob/contracts";
import { hashCanonicalJson } from "../lib/canonical-json.js";

export function experienceCaptureHash(kind: string, entry: ResumeStudioEntry): string {
  return hashCanonicalJson({
    kind,
    title: entry.title.trim(),
    organization: entry.organization.trim(),
    role: entry.role.trim(),
    startDate: entry.startDate.trim(),
    endDate: entry.endDate.trim(),
    body: resumeRichPlain(entry.body).normalize("NFKC").replace(/\s+/g, " ").trim(),
    ...(resumeEntryDetails(entry).length ? { details: resumeEntryDetails(entry) } : {}),
  });
}
export function hasEntryContent(entry: ResumeStudioEntry) {
  return resumeEntryHasContent(entry);
}
/** Read projection for existing Case/review/export consumers. The structured snapshot remains canonical. */
export function studioSemanticProjection(
  content: ResumeStudioContent,
): ResumeSemanticContent | null {
  const sections: ResumeSemanticContent["sections"] = [];
  const basics = content.basics;
  const contact = [
    basics.name,
    basics.headline,
    basics.phone,
    basics.email,
    basics.city,
    ...basics.links.map((l) => `${l.label} ${l.url}`),
  ]
    .filter(Boolean)
    .join(" · ");
  if (contact)
    sections.push({
      id: "00000000-0000-4000-8000-000000000001",
      ordinal: 0,
      title: "基本信息",
      blocks: [
        { id: "00000000-0000-4000-8000-000000000002", ordinal: 0, text: contact, evidenceIds: [] },
      ],
    });
  for (const section of content.sections.filter((s) => !s.hidden)) {
    const blocks = section.entries
      .filter((e) => !e.hidden && hasRenderableResumeEntry(e))
      .map((e, ordinal) => ({
        id: e.id,
        ordinal,
        evidenceIds: [],
        text: [
          [e.title, e.organization, e.role, e.degree, e.major, e.location]
            .filter(Boolean)
            .join(" · "),
          [e.startDate, e.endDate].filter(Boolean).join(" — "),
          resumeRichPlain(e.body),
          ...resumeEntryDetails(e).map((d) => `${d.label}：${d.value}`),
        ]
          .filter(Boolean)
          .join("\n")
          .slice(0, 10000),
      }));
    if (blocks.length)
      sections.push({ id: section.id, ordinal: sections.length, title: section.title, blocks });
  }
  return sections.length ? { schemaVersion: "resume-content-v1", sections } : null;
}
export function studioFromLegacy(content: ResumeSemanticContent): ResumeStudioContent {
  return {
    ...blankResumeStudioContent(),
    sections: content.sections.map((s) => ({
      id: s.id,
      kind: "custom",
      title: s.title,
      hidden: false,
      pageBreakBefore: false,
      column: "main",
      entries: s.blocks.map((b) => ({ ...blankResumeEntry(b.id), body: resumeRichText(b.text) })),
    })),
  };
}

const headings: [RegExp, ResumeSectionKind][] = [
  [/^(教育(?:背景|经历)|education)$/i, "education"],
  [/^(实习(?:经历|经验)|工作(?:经历|经验)|internships?|work experience)$/i, "internship"],
  [/^(项目(?:经历|经验)|projects?)$/i, "project"],
  [/^(科研(?:经历|经验|成果)|研究经历|research)$/i, "research"],
  [/^(论文(?:与成果|发表|成果)?|学术发表|publications)$/i, "publications"],
  [/^(语言(?:能力|水平)?|外语能力|languages)$/i, "languages"],
  [/^(证书|资格证书|certifications?|certificates?)$/i, "certificates"],
  [/^(校园(?:经历|活动)|社团(?:经历|活动)|志愿(?:经历|服务)|社会实践)$/, "activity"],
  [/^(技能(?:与工具|特长)?|专业技能|skills)$/i, "skills"],
  [/^(荣誉(?:奖项)?|奖项|获奖经历|awards?)$/i, "awards"],
  [/^(个人总结|个人简介|自我评价|summary)$/i, "summary"],
];
const dateRange =
  /(20\d{2}(?:[.年/\-]\d{1,2}月?)?)\s*(?:至|—+|–|~|～|\s-\s)\s*(20\d{2}(?:[.年/\-]\d{1,2}月?)?|至今|现在|Present)/i;
const proseStart =
  /^(?:[•●·\-*]|负责|参与|协助|完成|通过|针对|为了|基于|在此|其中|工作内容|项目背景|主要职责|成果)/;
const looksLikeHeader = (line: string) =>
  line.length <= 110 && !proseStart.test(line) && !/[。；;！？!?]$/.test(line);
function entryHeader(entry: ResumeStudioEntry, text: string, kind: ResumeSectionKind) {
  const parts = text
    .split(/\s*[|｜]\s*|\s+·\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  entry.title = parts.shift() ?? text.trim();
  if (parts.length && parts[0] === entry.title) parts.shift();
  if (kind === "education") {
    for (const part of parts) {
      if (/^(本科|学士|硕士|博士|大专|研究生)$/.test(part)) entry.degree = part;
      else entry.major = [entry.major, part].filter(Boolean).join(" · ");
    }
  } else {
    // Only explicit separators provide a boundary; unlabelled prose stays in the complete description.
    for (const part of parts) {
      if (
        /(实习生|实习岗|工程师|助理|经理|专员|负责人|成员|研究员|设计师|顾问)$/.test(part) &&
        !entry.role
      )
        entry.role = part;
      else entry.organization = [entry.organization, part].filter(Boolean).join(" · ");
    }
  }
}

/** Preserve whole descriptions. Date-bearing headers delimit records; bullet points do not. */
export function importStudioText(text: string): ResumeStudioContent {
  const result = blankResumeStudioContent();
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  result.basics.email = text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0] ?? "";
  result.basics.phone = text.match(/(?<!\d)(?:\+86[- ]?)?1[3-9]\d{9}(?!\d)/)?.[0] ?? "";
  const name = lines[0]?.replace(/^姓名\s*[:：]?\s*/, "");
  if (name && /^[\p{Script=Han}·]{2,12}$/u.test(name) && !headings.some(([r]) => r.test(name)))
    result.basics.name = name;
  const groups: { kind: ResumeSectionKind; title: string; lines: string[] }[] = [];
  let group: (typeof groups)[number] | undefined;
  for (const line of lines) {
    if (
      result.basics.name &&
      [result.basics.name, `姓名：${result.basics.name}`, `姓名: ${result.basics.name}`].includes(
        line,
      )
    )
      continue;
    const title = line.replace(/[:：]\s*$/, "");
    const heading = headings.find(([r]) => r.test(title));
    if (heading) {
      group = { kind: heading[1], title, lines: [] };
      groups.push(group);
      continue;
    }
    if (!group || group.title === "导入内容") {
      const remainder = line
        .replace(result.basics.email || "\u0000", "")
        .replace(result.basics.phone || "\u0000", "")
        .replace(/(?:电话|手机|邮箱|联系方式|电子邮件|Email|Phone)\s*[:：]?/gi, "")
        .replace(/[\s|｜·,，;；]+/g, "");
      if (!remainder) continue;
      if (!group) {
        group = { kind: "custom", title: "导入内容", lines: [] };
        groups.push(group);
      }
    }
    group.lines.push(line);
  }
  for (const source of groups) {
    const entries: ResumeStudioEntry[] = [];
    let entry = blankResumeEntry(randomUUID()),
      body: string[] = [];
    const flush = () => {
      entry.body = resumeRichText(body.join("\n"));
      if (hasEntryContent(entry) || entry.startDate) entries.push(entry);
      entry = blankResumeEntry(randomUUID());
      body = [];
    };
    const structured = ["education", "internship", "project", "research", "activity"].includes(
      source.kind,
    );
    for (const line of source.lines) {
      const dates =
        structured && !proseStart.test(line) && line.length < 180 ? line.match(dateRange) : null;
      if (dates) {
        let header = line.replace(dates[0], "").replace(/^[\s|｜·]+|[\s|｜·]+$/g, "");
        if (!header && body.length && looksLikeHeader(body[body.length - 1]!)) header = body.pop()!;
        if (entry.startDate || entry.title || body.length) flush();
        entryHeader(entry, header, source.kind);
        entry.startDate = dates[1] ?? "";
        entry.endDate = dates[2] ?? "";
        continue;
      }
      if (structured && entry.startDate && !body.length) {
        if (
          source.kind === "education" &&
          /^(本科|学士|硕士|博士|大专|研究生)(?:\s*[|｜·]\s*.+)?$/.test(line)
        ) {
          const parts = line.split(/\s*[|｜·]\s*/);
          entry.degree = parts[0] ?? "";
          entry.major = parts.slice(1).join(" · ");
          continue;
        }
        if (!entry.role && /^(?:角色|职位)[:：]\s*/.test(line)) {
          entry.role = line.replace(/^(?:角色|职位)[:：]\s*/, "");
          continue;
        }
        if (
          !entry.role &&
          line.length <= 35 &&
          /(?:实习生|助理|项目成员|小组成员|项目负责人|研究助理)$/.test(line)
        ) {
          entry.role = line;
          continue;
        }
      }
      body.push(line);
    }
    flush();
    result.sections.push({
      id: randomUUID(),
      kind: source.kind,
      title: source.title,
      hidden: false,
      pageBreakBefore: false,
      column: "main",
      entries,
    });
  }
  return result;
}
