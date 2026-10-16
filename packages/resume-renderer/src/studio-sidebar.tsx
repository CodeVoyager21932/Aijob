import type { NativeLayoutField, NativeResumeDocument } from "@aijob/resume-core";
import { Document, Image, Link, Page, View } from "@aijob/resume-forme/primitives";
import { StudioEditableText } from "./studio-editable-text.js";
import { StudioEntryView, safeStudioLink, studioNodeKey } from "./studio-entry.js";
import { type StudioSection, studioSections } from "./studio-model.js";
import { sidebarFieldPolicy, sidebarFieldText } from "./studio-sidebar-fields.js";

/** Persistent profile rail and a wide narrative column, with no secondary date gutter. */
export function SidebarDocument({ document }: { document: NativeResumeDocument }) {
  const { data } = document;
  const { page, typography, design, layout } = data.metadata;
  const body = typography.body;
  const color = design.colors.primary;
  const sideColor = "#273742";
  const pageWidth = 595.28;
  const sideWidth = (pageWidth * layout.sidebarWidth) / 100;
  const sidePadding = Math.min(15, page.marginX);
  const sideContentWidth = sideWidth - sidePadding * 2;
  // Name size is a design default; long names reflow rather than silently shrink.
  const nameSize = 22;
  const columnGap = Math.max(12, page.gapX);
  const mainWidth = pageWidth - sideWidth - columnGap - page.marginX;
  const tight = (page.sectionGap ?? 8) <= 5;
  const photo = !data.picture.hidden && !!data.picture.url;
  const sections = studioSections(document);
  const sideIds = new Set(layout.pages.flatMap((part) => part.sidebar));
  const narrative = sections.filter((section) => !sideIds.has(section.id));
  const education = sections.find((section) => section.id === "education");
  const narrativeEntries = narrative
    .filter((section) => section.id !== "summary")
    .flatMap((section) => section.entries);
  // A short resume uses the same identity rail as a local header, followed by a
  // full-width reading flow. It avoids packing most facts into a narrow rail
  // beside an empty narrative column. Saved placement and content stay intact.
  const narrativeLength = narrative.reduce(
    (total, section) =>
      total +
      section.entries.reduce(
        (length, entry) =>
          length +
          [
            entry.title,
            entry.date,
            ...entry.details.map((detail) => detail.text),
            ...entry.bodies,
            ...entry.links.map((link) => link.label),
          ]
            .join("")
            .replace(/<[^>]*>/gu, "")
            .replace(/\s/gu, "").length,
        0,
      ),
    0,
  );
  const shortMaterial =
    layout.pages.length === 1 &&
    sideIds.has("education") &&
    education?.entries.length === 1 &&
    !sections.some((section) => section.startOnNewPage) &&
    narrativeEntries.length <= 2 &&
    narrativeLength <= 400;
  const mainSections = sections.filter((section) => !sideIds.has(section.id));
  const shortHeaderSections = [
    ...sections.filter((section) => section.id === "summary"),
    ...(education ? [education] : []),
  ];
  const shortSections = sections.filter(
    (section) => !["summary", "education"].includes(section.id),
  );
  const contact = [
    { field: "phone", text: data.basics.phone },
    { field: "location", text: data.basics.location },
  ].filter((line) => line.text);
  const fieldInMain = (field: NativeLayoutField) =>
    document.fieldLayout?.[field]?.position === "main";
  const fieldView = (field: NativeLayoutField) => {
    const source = data.basics[field];
    if (!source) return null;
    const saved = document.fieldLayout?.[field];
    const next = document.textLayout?.[`basics:${field}`];
    const active = next?.sourceText === source ? next : undefined;
    const local = active
      ? {
          ...(saved?.position ? { position: saved.position } : {}),
          ...(active.lineMode ? { lineMode: active.lineMode } : {}),
        }
      : saved;
    const main = fieldInMain(field);
    return (
      <View
        key={field}
        wrap={false}
        data-resume-node={`${sidebarFieldPolicy(field, local)}${active?.lineMode === "manual" ? "/flow" : ""}`}
        style={{
          marginTop: !main && field === "headline" ? 5 : 0,
          marginBottom: main ? 6 : field === "email" ? 4 : 0,
        }}
      >
        <View data-resume-node={`page-1/basics/${field}`}>
          <StudioEditableText
            textId={`basics:${field}`}
            label={field === "headline" ? "求职方向" : "邮箱"}
            sourceText={source}
            style={{
              fontSize: local?.fontSize ?? Math.max(9.5, body.fontSize),
              color: main ? design.colors.text : "#ffffff",
            }}
          >
            {active ? source : sidebarFieldText(source, local)}
          </StudioEditableText>
        </View>
      </View>
    );
  };

  const sectionView = (
    section: StudioSection,
    index: number,
    sidebar: boolean,
    width = sidebar ? sideContentWidth : mainWidth,
  ) => (
    <View
      key={section.id}
      break={section.startOnNewPage}
      data-resume-node={studioNodeKey(section.id, undefined, sidebar ? "sidebar" : "main")}
      style={{
        marginTop:
          index === 0 && !sidebar
            ? 0
            : shortMaterial && !sidebar
              ? Math.max(12, page.sectionGap ?? 8)
              : (page.sectionGap ?? 8),
      }}
    >
      {section.showHeading && (
        <StudioEditableText
          textId={`section:${section.id}:heading`}
          label={`${section.title}标题`}
          wrap={false}
          style={{
            fontFamily: typography.heading.fontFamily,
            fontSize: sidebar
              ? Math.max(10.5, typography.heading.fontSize - 1)
              : typography.heading.fontSize,
            fontWeight: 700,
            color: sidebar ? "#ffffff" : color,
            borderBottomWidth: sidebar ? 0.5 : 1,
            borderBottomColor: sidebar ? "#71818b" : "#c9d8dc",
            paddingBottom: tight ? 3 : 4,
            marginBottom: tight ? 4 : 5,
            lineHeight: 1.2,
          }}
        >
          {section.title}
        </StudioEditableText>
      )}
      {section.entries.map((entry, entryIndex) => (
        <StudioEntryView
          key={entry.id}
          document={document}
          section={section}
          entry={entry}
          width={width}
          color={sidebar ? "#ffffff" : color}
          textColor={sidebar ? "#ffffff" : design.colors.text}
          mutedColor={sidebar ? "#dce6eb" : "#4b606b"}
          sidebar={sidebar}
          region={sidebar ? "sidebar" : "main"}
          last={entryIndex === section.entries.length - 1}
        />
      ))}
    </View>
  );

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
          paddingBottom: 0,
          fontFamily: body.fontFamily,
          fontSize: body.fontSize,
          lineHeight: body.lineHeight,
          color: design.colors.text,
          backgroundColor: design.colors.background,
        }}
      >
        <View
          style={{
            width: pageWidth - page.marginX,
            flexDirection: "row",
            gap: columnGap,
            alignItems: "stretch",
          }}
        >
          {/* A flowing background keeps overflowing columns pageable; Fixed adds a failing wrapper. */}
          <View
            style={{
              width: sideWidth,
              // The short-material profile ends with the header; the remaining
              // facts continue below it using the full width of the page.
              ...(shortMaterial ? {} : { minHeight: 841.89 }),
              flexShrink: 0,
              color: "#ffffff",
              backgroundColor: sideColor,
              paddingVertical: page.marginY,
            }}
          >
            <View wrap={false} data-resume-node="page-1/header">
              {photo && !shortMaterial && (
                <Image
                  src={data.picture.url}
                  style={{
                    width: 73,
                    height: 91,
                    marginLeft: (sideWidth - 73) / 2,
                    marginBottom: tight ? 10 : 13,
                    objectFit: "cover",
                  }}
                />
              )}
              <View
                style={{
                  width: sideWidth + 9,
                  backgroundColor: color,
                  paddingHorizontal: sidePadding,
                  paddingVertical: tight ? 10 : 12,
                }}
              >
                {!!data.basics.name && (
                  <StudioEditableText
                    textId={"basics:name"}
                    label={"姓名"}
                    style={{ fontSize: nameSize, fontWeight: 700, lineHeight: 1.2 }}
                  >
                    {data.basics.name}
                  </StudioEditableText>
                )}
                {!fieldInMain("headline") && fieldView("headline")}
              </View>
              <View style={{ paddingHorizontal: sidePadding, paddingTop: tight ? 8 : 11 }}>
                {contact
                  .filter((line) => line.field === "phone")
                  .map((line) => (
                    <StudioEditableText
                      textId={`basics:${line.field}`}
                      label={line.field === "phone" ? "电话" : "城市"}
                      key={line.field}
                      style={{ marginBottom: 4, fontSize: Math.max(9.5, body.fontSize) }}
                    >
                      {line.text}
                    </StudioEditableText>
                  ))}
                {!fieldInMain("email") && fieldView("email")}
                {contact
                  .filter((line) => line.field !== "phone")
                  .map((line) => (
                    <StudioEditableText
                      textId={`basics:${line.field}`}
                      label={line.field === "phone" ? "电话" : "城市"}
                      key={line.field}
                      style={{ marginBottom: 4, fontSize: Math.max(9.5, body.fontSize) }}
                    >
                      {line.text}
                    </StudioEditableText>
                  ))}
                {!!data.basics.website.url && (
                  <StudioEditableText
                    textId={"basics:website"}
                    label={"网址"}
                    style={{ marginBottom: 4, fontSize: Math.max(9.5, body.fontSize) }}
                  >
                    {safeStudioLink(data.basics.website.url) ? (
                      <Link src={data.basics.website.url} style={{ color: "#ffffff" }}>
                        {data.basics.website.label || data.basics.website.url}
                      </Link>
                    ) : (
                      data.basics.website.label || data.basics.website.url
                    )}
                  </StudioEditableText>
                )}
                {data.basics.customFields.map((field) => (
                  <StudioEditableText
                    textId={`basics:custom:${field.id}`}
                    label={"自定义联系方式"}
                    key={field.id}
                    style={{ marginBottom: 4, fontSize: Math.max(9.5, body.fontSize) }}
                  >
                    {field.link && safeStudioLink(field.link) ? (
                      <Link src={field.link} style={{ color: "#ffffff" }}>
                        {field.text}
                      </Link>
                    ) : (
                      field.text
                    )}
                  </StudioEditableText>
                ))}
              </View>
            </View>
            <View style={{ paddingHorizontal: sidePadding }}>
              {sections
                .filter((section) => !shortMaterial && sideIds.has(section.id))
                .map((section, index) => sectionView(section, index, true))}
            </View>
          </View>
          <View style={{ width: mainWidth, flexShrink: 0, paddingVertical: page.marginY }}>
            <View
              data-resume-node="page-1/basics/fields-main"
              style={{
                color: design.colors.text,
                marginBottom: fieldInMain("headline") || fieldInMain("email") ? 10 : 0,
              }}
            >
              {fieldInMain("headline") && fieldView("headline")}
              {fieldInMain("email") && fieldView("email")}
            </View>
            {shortMaterial && photo ? (
              <View>
                <View style={{ flexDirection: "row", gap: 15, alignItems: "flex-start" }}>
                  <View style={{ width: mainWidth - 88, flexShrink: 0 }}>
                    {shortHeaderSections
                      .filter((section) => section.id === "summary")
                      .map((section) => sectionView(section, 0, false, mainWidth - 88))}
                  </View>
                  <Image
                    src={data.picture.url}
                    style={{ width: 73, height: 91, flexShrink: 0, objectFit: "cover" }}
                  />
                </View>
                {shortHeaderSections
                  .filter((section) => section.id === "education")
                  .map((section) => sectionView(section, 1, false))}
              </View>
            ) : (
              (shortMaterial ? shortHeaderSections : mainSections).map((section, index) =>
                sectionView(section, index, false),
              )
            )}
          </View>
        </View>
        {shortMaterial && (
          <View
            style={{
              width: pageWidth - page.marginX * 2,
              marginHorizontal: page.marginX,
              paddingTop: 20,
              paddingBottom: page.marginY,
            }}
          >
            {shortSections.map((section, index) =>
              sectionView(section, index, false, pageWidth - page.marginX * 2),
            )}
          </View>
        )}
      </Page>
    </Document>
  );
}
