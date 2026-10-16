import type { NativeResumeDocument } from "@aijob/resume-core";
import { Link, Text, View } from "@aijob/resume-forme/primitives";
import { StudioEditableText } from "./studio-editable-text.js";
import type { StudioEntry, StudioSection } from "./studio-model.js";
import { richBlocks } from "./studio-rich-text.js";

export const safeStudioLink = (url: string) => /^(https?:\/\/|mailto:|tel:)/i.test(url);
export const studioNodeKey = (section: string, item?: string, region = "main") =>
  `page-1/region-${region}/section-${encodeURIComponent(section)}${item ? `/section-items/item-${encodeURIComponent(item)}` : ""}`;

/** Content is projected once; page composition remains specific to each template. */
export function StudioEntryView({
  document,
  section,
  entry,
  width,
  last = false,
  color = document.data.metadata.design.colors.primary,
  textColor = document.data.metadata.design.colors.text,
  mutedColor = "#526078",
  itemGap,
  sidebar = false,
  region = "main",
}: {
  document: NativeResumeDocument;
  section: StudioSection;
  entry: StudioEntry;
  width: number;
  last?: boolean;
  color?: string;
  textColor?: string;
  mutedColor?: string;
  itemGap?: number;
  sidebar?: boolean;
  region?: "main" | "sidebar";
}) {
  const { data } = document;
  const { typography, page } = data.metadata;
  const fontSize = Math.max(9.5, typography.body.fontSize);
  const type =
    section.id in data.sections
      ? section.id
      : data.customSections.find((item) => item.id === section.id)?.type;
  const compact = ["skills", "languages", "profiles", "interests"].includes(type ?? "");
  const academic = type === "education";
  const professional = type === "experience" || type === "volunteer";
  const project = type === "projects";
  const primary = academic
    ? ["degree", "area", "grade", "location"]
    : professional
      ? ["position", "location"]
      : project
        ? ["role", "unit", "location"]
        : [];
  const details = entry.details.filter((item) => primary.includes(item.field ?? ""));
  const extras = entry.details.filter((item) => !primary.includes(item.field ?? ""));
  const detailText = (items: typeof entry.details) =>
    items
      .map(
        (item) =>
          `${item.field === "grade" ? "成绩：" : item.label && !primary.includes(item.field ?? "") ? `${item.label}：` : ""}${item.text}`,
      )
      .join(" · ");
  const tight = (page.sectionGap ?? 8) <= 5;
  const paragraphGap = tight ? 1.5 : 2;
  return (
    <View
      data-resume-node={studioNodeKey(section.id, entry.id, region)}
      style={{
        marginBottom: last ? 0 : (itemGap ?? page.gapY),
        color: textColor,
        fontSize,
        letterSpacing: tight ? -0.1 : 0,
      }}
    >
      {(entry.title || entry.date || entry.details.length > 0) && (
        <View wrap={false}>
          <View
            style={{
              flexDirection: sidebar ? "column" : "row",
              alignItems: "baseline",
              gap: sidebar ? 1 : 9,
            }}
          >
            <StudioEditableText
              textId={`entry:${entry.id}:title`}
              label={"条目标题"}
              style={{
                ...(sidebar ? { width } : {}),
                flexGrow: 1,
                flexShrink: 1,
                fontWeight: 700,
              }}
            >
              {entry.title}
              {compact && extras.length > 0 ? "：" : ""}
              {compact && extras.length > 0 && (
                <StudioEditableText
                  textId={`entry:${entry.id}:extras`}
                  label={"补充信息"}
                  style={{ fontWeight: 400 }}
                >
                  {detailText(extras)}
                </StudioEditableText>
              )}
            </StudioEditableText>
            {!!entry.date && (
              <StudioEditableText
                textId={`entry:${entry.id}:date`}
                label={"时间"}
                style={{
                  fontSize,
                  color: mutedColor,
                  maxWidth: sidebar ? width : "37%",
                  textAlign: sidebar ? "left" : "right",
                }}
              >
                {entry.date}
              </StudioEditableText>
            )}
          </View>
          {sidebar && academic && details.length > 0 ? (
            <View style={{ marginTop: 1.5 }}>
              {[
                details.filter((item) => ["degree", "area"].includes(item.field ?? "")),
                details.filter((item) => ["grade", "location"].includes(item.field ?? "")),
              ]
                .filter((group) => group.length > 0)
                .map((group) => (
                  <StudioEditableText
                    textId={`entry:${entry.id}:details:${group.map((item) => item.field).join("-")}`}
                    label={"教育信息"}
                    key={group[0]?.field}
                    style={{ fontSize, color: mutedColor }}
                  >
                    {detailText(group)}
                  </StudioEditableText>
                ))}
            </View>
          ) : (
            details.length > 0 && (
              <StudioEditableText
                textId={`entry:${entry.id}:details`}
                label={"条目信息"}
                style={{ fontSize, color: mutedColor, marginTop: 1.5 }}
              >
                {detailText(details)}
              </StudioEditableText>
            )
          )}
          {type === "publications" && extras.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 1.5 }}>
              {extras.map((item) => (
                <StudioEditableText
                  textId={`entry:${entry.id}:detail:${item.field}`}
                  label={item.label || "补充信息"}
                  key={item.field}
                  style={{ fontSize, color: mutedColor, maxWidth: width, flexShrink: 0 }}
                >
                  {item.label ? `${item.label}：` : ""}
                  {item.text}
                </StudioEditableText>
              ))}
            </View>
          ) : (
            !compact &&
            extras.length > 0 && (
              <StudioEditableText
                textId={`entry:${entry.id}:extras`}
                label={"补充信息"}
                style={{ fontSize, color: mutedColor, marginTop: 1.5 }}
              >
                {detailText(extras)}
              </StudioEditableText>
            )
          )}
        </View>
      )}
      {entry.bodies.flatMap(richBlocks).map((block, index) => {
        const marker = typeof block[0] === "string" ? /^(\s*)(•|\d+\.) $/.exec(block[0]) : null;
        const indent = (marker?.[1]?.length ?? 0) * 4;
        const markerWidth = Math.max(9, (marker?.[2]?.length ?? 1) * fontSize * 0.55 + 2);
        return marker ? (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: immutable document render.
            key={index}
            style={{ flexDirection: "row", marginTop: paragraphGap, paddingLeft: indent }}
          >
            <Text style={{ width: markerWidth, flexShrink: 0, color }}>{marker[2]}</Text>
            <StudioEditableText
              textId={`entry:${entry.id}:body:${index}`}
              label={"正文段落"}
              orphans={2}
              widows={2}
              style={{ width: Math.max(20, width - indent - markerWidth), flexShrink: 0 }}
            >
              {block.slice(1)}
            </StudioEditableText>
          </View>
        ) : (
          <StudioEditableText
            textId={`entry:${entry.id}:body:${index}`}
            label={"正文段落"}
            // biome-ignore lint/suspicious/noArrayIndexKey: immutable document render.
            key={index}
            orphans={2}
            widows={2}
            style={{
              marginTop: paragraphGap,
              ...(section.id === "summary" ? { fontSize: Math.max(11, fontSize) } : {}),
            }}
          >
            {block}
          </StudioEditableText>
        );
      })}
      {entry.links.map((link, linkIndex) => (
        <StudioEditableText
          textId={`entry:${entry.id}:link:${linkIndex}`}
          label={"条目链接"}
          key={link.url}
          style={{ fontSize, marginTop: paragraphGap }}
        >
          {safeStudioLink(link.url) ? (
            <Link src={link.url} style={{ color, textDecoration: "underline" }}>
              {link.label}
            </Link>
          ) : (
            link.label
          )}
        </StudioEditableText>
      ))}
    </View>
  );
}
