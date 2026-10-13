import type { NativeImportBlock } from "./import-blocks.js";
import { educationHeader, experienceHeader, isStandaloneOrganizationLine, projectMetadata } from "./import-cn-fields.js";
import { nativeImportHeadingKind, type NativeImportKind } from "./import-headings.js";
import { createNativeResumeDocument, type NativeResumeDocument } from "./index.js";
import { ensureNativeResearchSection, newNativeItem } from "./items.js";
import { joinNativePeriodContinuations } from "./import-period-continuation.js";

type Kind = NativeImportKind;
export type NativeImportCorrections = Record<
  string,
  { section: Exclude<Kind, "unknown">; startsEntry: boolean }
>;
const periodPattern =
  /(?:19|20)\d{2}(?:[.年/-]\d{1,2}月?)?\s*[–—~～至-]\s*(?:(?:19|20)\d{2}(?:[.年/-]\d{1,2}月?)?|至今|现在|今)/;
const schoolPattern = /[\p{Script=Han}A-Za-z·]{2,35}(?:大学|学院|学校|University|College)/u;
const degreePattern = /博士研究生|硕士研究生|博士|硕士|本科|学士|专科/;
const bullet = /^\s*(?:[•·●▪\-*]|\d{1,3}[.)、])\s*/;
const html = (text: string) => {
  const marker = text.match(/^\s*(?:[•·●▪\-*]\s+|\d+[.)、]\s+)/);
  const content = (marker ? text.slice(marker[0].length) : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  return marker ? `<ul><li>${content}</li></ul>` : `<p>${content}</p>`;
};
export interface NativeImportMapping {
  blockId: string;
  sectionId: string;
  itemId?: string;
  field: string;
}
export interface NativeImportResult {
  document: NativeResumeDocument;
  mappings: NativeImportMapping[];
  quality: "structured" | "partial" | "unstructured";
  unclassifiedBlockIds: string[];
  reviewReasons: string[];
  parserVersion: "native-cn-v1" | "native-cn-v2" | "native-cn-v3" | "native-cn-v4" | "native-cn-v5" | "native-cn-v6" | "native-cn-v7" | "native-cn-v8" | "native-cn-v9";
}

/** Chinese classification consumes ordered blocks; the source blocks remain independently retrievable. */
export function importNativeChineseBlocks(
  sourceBlocks: readonly NativeImportBlock[],
  namespace: string,
  corrections: NativeImportCorrections = {},
): NativeImportResult {
  const { blocks, continuations } = joinNativePeriodContinuations(sourceBlocks, new Set(Object.keys(corrections)));
  const document = createNativeResumeDocument(),
    data = document.data,
    mappings: NativeImportMapping[] = [],
    unclassifiedBlockIds: string[] = [];
  let kind: Kind = "unknown",
    currentId: string | undefined,
    seenHeading = false;
  const reviewReasons = new Set<string>();
  const firstHeadingIndex = blocks.findIndex(
    (block) => nativeImportHeadingKind(block.text) !== undefined,
  );
  const map = (block: NativeImportBlock, sectionId: string, field: string, itemId?: string) => {
    mappings.push({ blockId: block.id, sectionId, field, ...(itemId ? { itemId } : {}) });
    const continuation = continuations.get(block.id);
    if (continuation) mappings.push({ blockId: continuation, sectionId, field: field === "header" ? "period" : field, ...(itemId ? { itemId } : {}) });
  };
  const unknown = (block: NativeImportBlock) => {
    const id = `${namespace}:unclassified`;
    let section = data.customSections.find((value) => value.id === id);
    if (!section) {
      section = {
        id,
        type: "summary",
        title: "待整理内容",
        icon: "",
        columns: 1,
        hidden: false,
        keepTogether: false,
        startOnNewPage: false,
        items: [],
      };
      data.customSections.push(section);
      data.metadata.layout.pages[0]?.main.push(id);
    }
    if (section.type !== "summary") throw new Error("NATIVE_IMPORT_SECTION_TYPE");
    const itemId = `${namespace}:${block.id}`;
    section.items.push({ id: itemId, hidden: false, content: html(block.text) });
    unclassifiedBlockIds.push(block.id);
    const continuation = continuations.get(block.id);
    if (continuation) unclassifiedBlockIds.push(continuation);
    map(block, id, "content", itemId);
  };
  for (const [index, block] of blocks.entries()) {
    const text = block.text.trim();
    if (!text) continue;
    const correction = corrections[block.id];
    if (correction) {
      if (kind !== correction.section || correction.startsEntry) currentId = undefined;
      kind = correction.section;
      seenHeading = true;
    }
    if (block.link) {
      if (block.link.url === `mailto:${data.basics.email}` && data.basics.email) {
        map(block, "basics", "email");
        continue;
      }
      if (block.link.url === `tel:${data.basics.phone}` && data.basics.phone) {
        map(block, "basics", "phone");
        continue;
      }
      const relatedIndex = blocks.findIndex((value) => value.id === block.link?.relatedBlockId);
      if (
        /^https?:\/\//.test(block.link.url) &&
        relatedIndex >= 0 &&
        (firstHeadingIndex < 0 || relatedIndex < firstHeadingIndex) &&
        !data.basics.website.url
      ) {
        data.basics.website = { url: block.link.url, label: block.link.label };
        map(block, "basics", "website");
        continue;
      }
      const related = mappings.find(
        (value) => value.blockId === block.link?.relatedBlockId && value.itemId,
      );
      const item = related
        ? [...Object.values(data.sections), ...data.customSections]
            .flatMap((section) => section.items)
            .find((value) => value.id === related.itemId)
        : undefined;
      if (
        related &&
        item &&
        "website" in item &&
        typeof item.website === "object" &&
        item.website !== null &&
        "url" in item.website &&
        !item.website.url
      ) {
        item.website = { url: block.link.url, label: block.link.label, inlineLink: false };
        map(block, related.sectionId, "website", item.id);
      } else {
        unknown(block);
        reviewReasons.add("link-association");
      }
      continue;
    }
    const heading = nativeImportHeadingKind(text);
    // 项目成果 can also be a subheading inside an existing experience. Only treat it
    // as a new section when the following line has an explicit dated entry boundary.
    if (
      heading === "projects" &&
      text.replace(/^[^\p{Script=Han}\d\s]\s+/u, "").replace(/[\s：:／/]/g, "") === "项目成果" &&
      (kind === "experience" || kind === "projects") &&
      currentId &&
      !periodPattern.test(blocks[index + 1]?.text ?? "")
    ) {
      const section = kind === "experience" ? data.sections.experience : data.sections.projects;
      const item = section.items.find((value) => value.id === currentId);
      if (item) {
        item.description += html(text);
        map(block, kind, "description", item.id);
        continue;
      }
    }
    if (heading) {
      kind = heading;
      currentId = undefined;
      seenHeading = true;
      map(
        block,
        kind === "research" ? ensureNativeResearchSection(data, `${namespace}:research`).id : kind,
        "title",
      );
      continue;
    }
    if (!seenHeading) {
      let rest = text;
      const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
      const phone = text.match(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/)?.[0];
      if (email) {
        data.basics.email = email;
        rest = rest.replace(email, "").replace(/邮\s*箱\s*[:：]?/, "");
        map(block, "basics", "email");
      }
      if (phone) {
        data.basics.phone = phone;
        rest = rest.replace(phone, "").replace(/(?:电话|手机|联系方式)\s*[:：]?/, "");
        map(block, "basics", "phone");
      }
      const explicitName = rest.match(/姓名\s*[:：]\s*([^\s|｜]{1,30})/);
      if (explicitName) {
        data.basics.name = explicitName[1] ?? "";
        rest = rest.replace(explicitName[0], "");
        map(block, "basics", "name");
      }
      const name = rest.replace(/[|｜]/g, "").trim();
      // Preserve a display name literally (including aliases), using header position
      // and a following contact line rather than inventing a person's legal name.
      const aliasHeader =
        index === 0 &&
        /^[\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9· .'-]{1,29}$/u.test(name) &&
        blocks
          .slice(1, 3)
          .some((next) =>
            /(?:邮箱|电话|手机)\s*[:：]|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(next.text),
          );
      if (
        !data.basics.name &&
        index < 4 &&
        !/简历|求职|个人|应聘/.test(name) &&
        (/^(?:[\p{Script=Han}·]{2,6}|[A-Za-z][A-Za-z .'-]{1,28})$/u.test(name) || aliasHeader)
      ) {
        data.basics.name = name;
        rest = "";
        map(block, "basics", "name");
      }
      const headline = rest.match(/(?:求职意向|求职方向|应聘岗位)\s*[:：]\s*(.+)/);
      if (headline) {
        data.basics.headline = headline[1] ?? "";
        rest = rest.replace(headline[0], "");
        map(block, "basics", "headline");
      } else if (
        data.basics.name &&
        !data.basics.headline &&
        /^(?:[\p{Script=Han}A-Za-z ]{0,24})(?:实习生|工程师|助理|管培生|设计师|分析师|运营|专员)$/u.test(
          rest.trim(),
        )
      ) {
        data.basics.headline = rest.trim();
        rest = "";
        map(block, "basics", "headline");
      }
      for (const linked of blocks.filter(
        (value) => value.link?.relatedBlockId === block.id && /^https?:\/\//.test(value.link.url),
      )) {
        const label = linked.link?.label;
        if (label && rest.includes(label)) {
          rest = rest.replace(label, "");
          map(block, "basics", "website-label");
        }
      }
      if (rest.replace(/[|｜\s]/g, "") && !/^(个人)?简历$/.test(rest.trim()))
        unknown({ ...block, text: rest.trim() });
      else if (!mappings.some((value) => value.blockId === block.id))
        map(block, "basics", "document-label");
      continue;
    }
    if (kind === "unknown") {
      unknown(block);
      continue;
    }
    if (kind === "summary") {
      data.summary.content += html(text);
      map(block, "summary", "content");
      continue;
    }
    const period = text.match(periodPattern)?.[0];
    const dateOnly = period && text.replace(period, "").replace(/[|｜\s]/g, "") === "";
    const id = `${namespace}:${block.id}`;
    if (kind === "education") {
      const currentEducation = data.sections.education.items.find(
        (value) => value.id === currentId,
      );
      const school = text.match(schoolPattern)?.[0];
      const schoolHeader =
        school && !bullet.test(text) && !/[。；]/.test(text) && text.length < 100;
      const nextSchool = blocks[index + 1]?.text;
      const startsDateFirst =
        !!period &&
        !!currentEducation?.school &&
        !bullet.test(text) &&
        !/[。；]/.test(text) &&
        text.length < 100 &&
        !!nextSchool?.match(schoolPattern) &&
        nextSchool.length < 100 &&
        !/[。；]/.test(nextSchool);
      if (
        !currentId ||
        startsDateFirst ||
        (schoolHeader &&
          (!currentEducation || !!currentEducation.school || !!currentEducation.description))
      ) {
        currentId = id;
        data.sections.education.items.push({
          id,
          hidden: false,
          school: school ?? "",
          degree: text.match(degreePattern)?.[0] ?? "",
          area: "",
          grade: "",
          location: "",
          period: period ?? "",
          website: { url: "", label: "", inlineLink: false },
          description: "",
        });
        const item = data.sections.education.items.at(-1);
        if (!item) throw new Error("NATIVE_IMPORT_ENTRY_MISSING");
        const rest = educationHeader(text, item);
        if (rest) item.description = html(rest);
        map(block, "education", "header", id);
      } else {
        const item = data.sections.education.items.find((value) => value.id === currentId);
        if (!item) throw new Error("NATIVE_IMPORT_ENTRY_MISSING");
        if (schoolHeader && !item.school) item.school = school;
        if (period && !item.period) item.period = period;
        if (!item.degree) item.degree = text.match(degreePattern)?.[0] ?? "";
        const rest = educationHeader(text, item);
        if (rest) item.description += html(rest);
        map(block, "education", dateOnly ? "period" : "description", item.id);
      }
      continue;
    }
    if (
      kind === "experience" ||
      kind === "projects" ||
      kind === "research" ||
      kind === "volunteer"
    ) {
      const next = blocks[index + 1];
      const target =
        kind === "research"
          ? ensureNativeResearchSection(data, `${namespace}:research`)
          : kind === "experience"
            ? data.sections.experience
            : kind === "volunteer"
              ? data.sections.volunteer
              : data.sections.projects;
      const current = target.items.find((value) => value.id === currentId);
      const isBullet = block.kind === "list-item" || bullet.test(text);
      const awaitingMetadata =
        !!current &&
        !current.description &&
        (!current.period || (kind === "experience" && "company" in current && !current.company));
      const starts =
        !current ||
        (!dateOnly &&
          !isBullet &&
          !awaitingMetadata &&
          (block.emphasis === true ||
            !!period ||
            (!!next?.text.match(periodPattern) && text.length < 75)));
      const sectionId = kind === "research" ? `${namespace}:research` : kind;
      if (starts) {
        currentId = id;
        const title = text.replace(period ?? "", "").trim();
        if (kind === "experience") {
          data.sections.experience.items.push({
            id,
            hidden: false,
            company: title,
            position: "",
            location: "",
            period: period ?? "",
            website: { url: "", label: "", inlineLink: false },
            description: "",
            roles: [],
          });
          const item = data.sections.experience.items.at(-1);
          if (!item) throw new Error("NATIVE_IMPORT_ENTRY_MISSING");
          experienceHeader(text, item, true);
        } else if (kind === "volunteer") {
          const item = newNativeItem("volunteer", id);
          item.organization = title;
          item.period = period ?? "";
          data.sections.volunteer.items.push(item);
        } else {
          const item = newNativeItem("projects", id);
          item.name = title;
          item.period = period ?? "";
          (target.items as typeof data.sections.projects.items).push(item);
        }
        map(block, sectionId, "header", id);
      } else {
        const item = target.items.find((value) => value.id === currentId);
        if (!item) throw new Error("NATIVE_IMPORT_ENTRY_MISSING");
        if (period && !item.period) item.period = period;
        if (dateOnly) item.period = period;
        else {
          const experience =
            kind === "experience"
              ? data.sections.experience.items.find((value) => value.id === currentId)
              : undefined;
          const rest = experience
            ? experienceHeader(
                text,
                experience,
                !experience.company &&
                  !experience.description &&
                  !isBullet &&
                  text.length < 75 &&
                  isStandaloneOrganizationLine(text),
              )
            : kind === "projects" || kind === "research"
              ? projectMetadata(text, item as { role?: string; unit?: string; method?: string })
              : text;
          if (rest) item.description += html(rest);
        }
        map(block, sectionId, dateOnly ? "period" : "description", item.id);
      }
      continue;
    }
    if (kind === "skills") {
      const previous = data.sections.skills.items.find((value) => value.id === currentId);
      if (
        previous &&
        /^(?:技能)?(?:补充|说明|实践|使用场景|应用案例|实践成果)\s*[:：]/.test(text)
      ) {
        previous.description = (previous.description ?? "") + html(text);
        map(block, kind, "description", previous.id);
        continue;
      }
      if (previous && !block.emphasis && !text.includes(":") && !text.includes("：")) {
        const preceding = blocks[index - 1];
        const a = preceding?.source,
          b = block.source;
        const softWrap =
          a?.kind === "pdf" &&
          b.kind === "pdf" &&
          a.page === b.page &&
          a.column === b.column &&
          Math.abs(a.x - b.x) <= Math.max(a.fontSize, b.fontSize) &&
          b.y > a.y &&
          b.y - a.y <= Math.max(a.fontSize, b.fontSize) * 1.8 &&
          !/[。！？；.!?;]$/.test(preceding?.text ?? "") &&
          !bullet.test(text);
        const separator = softWrap
          ? /[\p{Script=Han}]$/u.test(previous.proficiency) || /^[\p{Script=Han}，。]/u.test(text)
            ? ""
            : " "
          : "\n";
        previous.proficiency = [previous.proficiency, text].filter(Boolean).join(separator);
        map(block, kind, "proficiency", previous.id);
        if (!softWrap) reviewReasons.add("skill-entry-boundary");
        continue;
      }
      const item = newNativeItem("skills", id),
        parts = text.split(/[:：]/);
      item.name = parts.shift() ?? text;
      item.proficiency = parts.join("：");
      data.sections.skills.items.push(item);
      currentId = id;
      map(block, kind, "name", id);
      continue;
    }
    if (kind === "languages") {
      const header = text.match(
        /^(英语|日语|韩语|法语|德语|俄语|西班牙语|阿拉伯语|普通话|粤语|English|Japanese|French|German)(?:\s*[:：]\s*|\s+|$)(.*)$/i,
      );
      const previous = data.sections.languages.items.find((item) => item.id === currentId);
      if (
        previous &&
        !header &&
        /^(使用说明|实践|补充|成绩|证书|阅读|口语|听力|写作)[:：]|^[•·●▪*-]/.test(text)
      ) {
        previous.description = (previous.description ?? "") + html(text);
        map(block, kind, "description", previous.id);
      } else {
        const item = newNativeItem("languages", id);
        item.language = header?.[1] ?? text;
        item.fluency = header?.[2]?.trim() ?? "";
        data.sections.languages.items.push(item);
        currentId = item.id;
        map(block, kind, "language", id);
        if (item.fluency) map(block, kind, "fluency", id);
        if (!header) reviewReasons.add("language-metadata");
      }
      continue;
    }
    if (kind === "publications" || kind === "certifications" || kind === "awards") {
      const section = data.sections[kind];
      const current = section.items.find((value) => value.id === currentId);
      const fields: Record<string, string> =
        kind === "publications"
          ? {
              作者: "authors",
              本人署名顺序: "authorPosition",
              署名顺序: "authorPosition",
              期刊: "publisher",
              会议: "publisher",
              刊物: "publisher",
              发表状态: "status",
              发表时间: "date",
              发表年份: "date",
            }
          : kind === "certifications"
            ? { 颁发机构: "issuer", 授予机构: "issuer", 获得时间: "date", 颁发时间: "date" }
            : { 授予单位: "awarder", 颁发机构: "awarder", 获奖时间: "date", 获得时间: "date" };
      const labelled = text.match(/^([^：:]{2,8})\s*[:：]\s*(.+)$/);
      const field = labelled?.[1] ? fields[labelled[1]] : undefined;
      const standaloneDate = text.match(/^(?:19|20)\d{2}(?:[./年-]\d{1,2}月?)?$/)?.[0];
      if (field || standaloneDate) {
        if (current) {
          Object.assign(current, { [field ?? "date"]: labelled?.[2]?.trim() ?? standaloneDate });
          map(block, kind, field ?? "date", current.id);
        } else {
          unknown(block);
          reviewReasons.add(`${kind}-unattached-metadata`);
        }
        continue;
      }
      const explicitTitle = text.match(
        /^(?:论文题目|论文标题|成果名称|证书名称|奖项名称)\s*[:：]\s*(.+)$/,
      )?.[1];
      const datedTitle =
        kind !== "publications"
          ? text.match(/^(.{2,90}?)\s+((?:19|20)\d{2}[./年-]\d{1,2}月?)$/)
          : null;
      if (!current || block.emphasis || explicitTitle || datedTitle) {
        const item = newNativeItem(kind, id);
        item.title = explicitTitle ?? datedTitle?.[1]?.trim() ?? text;
        item.date = datedTitle?.[2] ?? "";
        // Both the section and item are selected by the same credential kind.
        (section.items as (typeof item)[]).push(item);
        currentId = id;
        map(block, kind, "title", id);
        if (item.date) map(block, kind, "date", id);
      } else {
        current.description += html(text);
        map(block, kind, "description", current.id);
        reviewReasons.add(`${kind}-metadata`);
      }
    }
  }
  const recognized = new Set(
    mappings
      .filter(
        (value) =>
          !["basics", "unknown"].includes(value.sectionId) &&
          !value.sectionId.endsWith(":unclassified"),
      )
      .map((value) => value.sectionId),
  );
  if (unclassifiedBlockIds.length) reviewReasons.add("unclassified-content");
  // Mapping all lines only proves retention. It does not prove correct entry boundaries
  // or typed metadata; ambiguous interpretation remains visible to the caller.
  if (blocks.some((block) => block.source.kind === "pdf"))
    reviewReasons.add("pdf-entry-boundaries");
  document.sourceBindings = mappings.map((mapping) => ({ originalId: namespace, ...mapping }));
  return {
    document,
    mappings,
    quality:
      recognized.size === 0
        ? "unstructured"
        : recognized.size >= 2 && !reviewReasons.size
          ? "structured"
          : "partial",
    unclassifiedBlockIds,
    reviewReasons: [...reviewReasons],
    parserVersion: "native-cn-v9",
  };
}
