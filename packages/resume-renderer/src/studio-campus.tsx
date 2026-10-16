import type { NativeResumeDocument } from "@aijob/resume-core";
import { Document, Image, Link, Page, Svg, Text, View } from "@aijob/resume-forme/primitives";
import { StudioContacts, StudioEditableText } from "./studio-editable-text.js";
import { type StudioEntry, type StudioSection, studioSections } from "./studio-model.js";
import { richBlocks } from "./studio-rich-text.js";

const safeLink = (url: string) => /^(https?:\/\/|mailto:|tel:)/i.test(url);
const key = (section: string, item?: string) =>
  `page-1/region-main/section-${encodeURIComponent(section)}${item ? `/section-items/item-${encodeURIComponent(item)}` : ""}`;

/** Independent Chinese graduate layout; reads the saved schema without changing personal facts. */
export function CampusDocument({ document }: { document: NativeResumeDocument }) {
  const { data } = document;
  const { page, typography, design } = data.metadata;
  const body = typography.body;
  const color = design.colors.primary;
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color);
  const svgColor = rgb
    ? `#${rgb
        .slice(1, 4)
        .map((value) => Number(value).toString(16).padStart(2, "0"))
        .join("")}`
    : /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(color)
      ? color
      : "#3b78db";
  const tight = (page.sectionGap ?? 8) <= 5;
  const photo = !data.picture.hidden && !!data.picture.url;
  const width = 595.28;
  const contact = [data.basics.phone, data.basics.email, data.basics.location].filter(Boolean);
  const sections = studioSections(document);

  function entry(part: StudioEntry, section: StudioSection, last: boolean) {
    const type =
      section.id in data.sections
        ? section.id
        : data.customSections.find((item) => item.id === section.id)?.type;
    const academic = type === "education";
    const experience = type === "experience";
    const project = type === "projects";
    const organization = type === "volunteer";
    const compact = ["skills", "languages", "profiles", "interests"].includes(type ?? "");
    const detail = (field: string) => part.details.find((item) => item.field === field)?.text;
    const education = ["degree", "area", "grade", "location"];
    const primary = academic
      ? education
      : experience || organization
        ? ["position", "location"]
        : project
          ? ["role", "unit", "location"]
          : [];
    const extras = part.details.filter((item) => !primary.includes(item.field ?? ""));
    const locationOnly = organization && !!detail("location") && !detail("position");
    const dateLine = [part.date, locationOnly ? detail("location") : ""]
      .filter(Boolean)
      .join("  ·  ");
    return (
      <View
        key={part.id}
        data-resume-node={key(section.id, part.id)}
        style={{
          marginBottom: last ? 0 : project ? Math.max(5, page.gapY) : page.gapY,
          letterSpacing: tight ? (compact ? -0.25 : -0.12) : 0,
        }}
      >
        {(part.title || part.date || part.details.length > 0) && (
          <View wrap={false}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 12 }}>
              <StudioEditableText
                textId={`entry:${part.id}:title`}
                label={"条目标题"}
                style={{ flexGrow: 1, flexShrink: 1, fontWeight: 700, color: "#202e42" }}
              >
                {part.title}
                {compact && extras.length > 0 ? "：" : ""}
                {compact && extras.length > 0 && (
                  <StudioEditableText
                    textId={`entry:${part.id}:extras`}
                    label={"补充信息"}
                    style={{ fontWeight: 400 }}
                  >
                    {extras.map((item) => item.text).join(" · ")}
                  </StudioEditableText>
                )}
              </StudioEditableText>
              {!!dateLine && (
                <StudioEditableText
                  textId={`entry:${part.id}:date`}
                  label={"时间"}
                  style={{
                    fontSize: body.fontSize - 0.5,
                    color: "#526078",
                    maxWidth: "37%",
                    textAlign: "right",
                  }}
                >
                  {dateLine}
                </StudioEditableText>
              )}
            </View>
            {academic && primary.some((field) => detail(field)) && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 2 }}>
                {education
                  .filter((field) => detail(field))
                  .map((field) => (
                    <StudioEditableText
                      textId={`entry:${part.id}:detail:${field}`}
                      label={field === "grade" ? "成绩" : "教育信息"}
                      key={field}
                      style={{ color: "#4c5b71", fontSize: body.fontSize - 0.3 }}
                    >
                      {field === "grade" ? "成绩：" : ""}
                      {detail(field)}
                    </StudioEditableText>
                  ))}
              </View>
            )}
            {(experience || organization || project) &&
              !locationOnly &&
              primary.some((field) => detail(field)) && (
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    gap: 12,
                    marginTop: 2,
                  }}
                >
                  <StudioEditableText
                    textId={`entry:${part.id}:details`}
                    label={"条目信息"}
                    style={{
                      flexGrow: 1,
                      flexShrink: 1,
                      color: "#4c5b71",
                      fontSize: body.fontSize - 0.2,
                    }}
                  >
                    {project
                      ? [detail("role"), detail("unit")].filter(Boolean).join(" · ")
                      : detail("position")}
                  </StudioEditableText>
                  <StudioEditableText
                    textId={`entry:${part.id}:detail:location`}
                    label={"地点"}
                    style={{
                      maxWidth: "37%",
                      textAlign: "right",
                      color: "#526078",
                      fontSize: body.fontSize - 0.5,
                    }}
                  >
                    {detail("location")}
                  </StudioEditableText>
                </View>
              )}
            {type === "publications" && extras.length > 0 ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 2 }}>
                {extras.map((item) => (
                  <StudioEditableText
                    textId={`entry:${part.id}:detail:${item.field}`}
                    label={item.label || "补充信息"}
                    key={item.field}
                    style={{
                      fontSize: body.fontSize - 0.2,
                      color: "#526078",
                      maxWidth: width - page.marginX * 2,
                      flexShrink: 0,
                    }}
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
                  textId={`entry:${part.id}:extras`}
                  label="补充信息"
                  style={{ fontSize: body.fontSize - 0.2, color: "#526078", marginTop: 2 }}
                >
                  {extras
                    .map((item) => `${item.label ? `${item.label}：` : ""}${item.text}`)
                    .join(" · ")}
                </StudioEditableText>
              )
            )}
          </View>
        )}
        {part.bodies.flatMap(richBlocks).map((block, index) => {
          const marker = typeof block[0] === "string" ? /^(\s*)(•|\d+\.) $/.exec(block[0]) : null;
          const indent = (marker?.[1]?.length ?? 0) * 4;
          const markerWidth = Math.max(9, (marker?.[2]?.length ?? 1) * body.fontSize * 0.55 + 2);
          return marker ? (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: immutable PDF render has no component state.
              key={index}
              style={{ flexDirection: "row", marginTop: 2, paddingLeft: indent }}
            >
              <Text
                style={{
                  width: markerWidth,
                  flexShrink: 0,
                }}
              >
                {marker[2] ?? "•"}
              </Text>
              <StudioEditableText
                textId={`entry:${part.id}:body:${index}`}
                label={"正文段落"}
                orphans={2}
                widows={2}
                style={{ width: width - page.marginX * 2 - indent - markerWidth, flexShrink: 0 }}
              >
                {block.slice(1)}
              </StudioEditableText>
            </View>
          ) : (
            <StudioEditableText
              textId={`entry:${part.id}:body:${index}`}
              label={"正文段落"}
              // biome-ignore lint/suspicious/noArrayIndexKey: immutable PDF render has no component state.
              key={index}
              orphans={2}
              widows={2}
              style={{
                marginTop: 2,
                ...(section.id === "summary" ? { fontSize: Math.max(11, body.fontSize) } : {}),
              }}
            >
              {block}
            </StudioEditableText>
          );
        })}
        {part.links.map((link, linkIndex) => (
          <StudioEditableText
            textId={`entry:${part.id}:link:${linkIndex}`}
            label={"条目链接"}
            key={link.url}
            style={{ fontSize: body.fontSize - 0.5, marginTop: 2 }}
          >
            {safeLink(link.url) ? (
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

  return (
    <Document
      title={data.basics.name}
      author={data.basics.name}
      creator="Aijob"
      language="zh-CN"
      hyphenation="manual"
    >
      <Page
        size="A4"
        style={{
          paddingHorizontal: 0,
          paddingTop: 0,
          paddingBottom: page.marginY,
          fontFamily: body.fontFamily,
          fontSize: body.fontSize,
          lineHeight: body.lineHeight,
          color: design.colors.text,
          backgroundColor: design.colors.background,
        }}
      >
        <View wrap={false} data-resume-node="page-1/header" style={{ paddingBottom: 3 }}>
          <Svg
            width={width}
            height={photo ? 92 : 60}
            viewBox={`0 0 595.28 ${photo ? 92 : 60}`}
            content={`<path fill="${svgColor}" d="${photo ? "M0 0H595.28V48Q297.64 105 0 48Z" : "M0 0H595.28V30Q297.64 78 0 30Z"}"/>`}
          />
          <View style={{ marginTop: photo ? -70 : -2, paddingHorizontal: page.marginX }}>
            {photo && (
              <View
                style={{
                  marginLeft: (width - page.marginX * 2 - 72) / 2,
                  width: 72,
                  height: 72,
                  borderRadius: 36,
                  overflow: "hidden",
                  borderWidth: 4,
                  borderColor: "#ffffff",
                  marginBottom: 5,
                  backgroundColor: "#ffffff",
                }}
              >
                <Image
                  src={data.picture.url}
                  style={{ width: 64, height: 64, borderRadius: 32, objectFit: "cover" }}
                />
              </View>
            )}
            {!!data.basics.name && (
              <StudioEditableText
                textId={"basics:name"}
                label={"姓名"}
                style={{
                  textAlign: "center",
                  fontSize: 18.5,
                  fontWeight: 700,
                  color: "#1e2b40",
                  lineHeight: 1.2,
                }}
              >
                {data.basics.name}
              </StudioEditableText>
            )}
            {!!data.basics.headline && (
              <StudioEditableText
                textId={"basics:headline"}
                label={"求职方向"}
                style={{ textAlign: "center", color: "#4c5b71", fontSize: 9.5, marginTop: 3 }}
              >
                {data.basics.headline}
              </StudioEditableText>
            )}
            {!!contact.length && (
              <StudioContacts
                basics={data.basics}
                separator={"  |  "}
                style={{ textAlign: "center", color: "#526078", fontSize: 8.7, marginTop: 3 }}
              />
            )}
            {!!data.basics.website.url && (
              <StudioEditableText
                textId={"basics:website"}
                label={"网址"}
                style={{ textAlign: "center", fontSize: 8.7, marginTop: 3 }}
              >
                <Link src={data.basics.website.url} style={{ color }}>
                  {data.basics.website.label || data.basics.website.url}
                </Link>
              </StudioEditableText>
            )}
            {data.basics.customFields.map((field) => (
              <StudioEditableText
                textId={`basics:custom:${field.id}`}
                label={"自定义联系方式"}
                key={field.id}
                style={{ textAlign: "center", fontSize: 8.7, marginTop: 2 }}
              >
                {field.link && safeLink(field.link) ? (
                  <Link src={field.link} style={{ color }}>
                    {field.text}
                  </Link>
                ) : (
                  field.text
                )}
              </StudioEditableText>
            ))}
          </View>
        </View>
        <View style={{ paddingHorizontal: page.marginX }}>
          {sections.map((section) => (
            <View
              key={section.id}
              break={section.startOnNewPage}
              data-resume-node={key(section.id)}
              style={{ marginTop: page.sectionGap ?? 8 }}
            >
              {section.showHeading && (
                <StudioEditableText
                  textId={`section:${section.id}:heading`}
                  label={`${section.title}标题`}
                  wrap={false}
                  style={{
                    textAlign: "center",
                    fontFamily: typography.heading.fontFamily,
                    fontSize: typography.heading.fontSize,
                    color,
                    borderBottomWidth: 0.5,
                    borderBottomColor: color,
                    paddingBottom: 2,
                    marginBottom: tight ? 3 : 4,
                    letterSpacing: 0.8,
                  }}
                >
                  {section.title}
                </StudioEditableText>
              )}
              {section.entries.map((item, index) =>
                entry(item, section, index === section.entries.length - 1),
              )}
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}
