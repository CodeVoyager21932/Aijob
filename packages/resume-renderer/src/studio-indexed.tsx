import type { NativeResumeDocument } from "@aijob/resume-core";
import { Document, Image, Link, Page, View } from "@aijob/resume-forme/primitives";
import { StudioContacts, StudioEditableText } from "./studio-editable-text.js";
import { StudioEntryView, safeStudioLink, studioNodeKey } from "./studio-entry.js";
import { studioSections } from "./studio-model.js";

/** A short identity band and a section index; the left rail never contains personal facts. */
export function IndexedDocument({ document }: { document: NativeResumeDocument }) {
  const { data } = document;
  const { page, typography, design } = data.metadata;
  const body = typography.body;
  const color = design.colors.primary;
  const contentWidth = 595.28 - page.marginX * 2;
  const indexWidth = 72;
  // The index already reserves padding after its label; keep the reading column wide.
  const indexGap = 6;
  const entryWidth = contentWidth - indexWidth - indexGap;
  const sectionGap = page.sectionGap ?? 8;
  const photo = !data.picture.hidden && !!data.picture.url;
  const contact = [data.basics.phone, data.basics.email, data.basics.location].filter(Boolean);
  const sections = studioSections(document);

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
          paddingBottom: page.marginY,
          fontFamily: body.fontFamily,
          fontSize: Math.max(9.5, body.fontSize),
          lineHeight: body.lineHeight,
          color: design.colors.text,
          backgroundColor: design.colors.background,
        }}
      >
        <View
          wrap={false}
          data-resume-node="page-1/header"
          style={{
            minHeight: photo ? 98 : 91,
            paddingHorizontal: page.marginX,
            paddingVertical: 15,
            flexDirection: "row",
            alignItems: "center",
            gap: 17,
            backgroundColor: color,
            borderBottomWidth: 2,
            borderBottomColor: "#bfaa7c",
          }}
        >
          {photo && (
            <View
              style={{ padding: 2, borderWidth: 0.75, borderColor: "#d7c5a1", borderRadius: 3 }}
            >
              <Image
                src={data.picture.url}
                style={{ width: 52, height: 65, objectFit: "cover", borderRadius: 1 }}
              />
            </View>
          )}
          <View style={{ flexGrow: 1, flexShrink: 1, color: "#ffffff" }}>
            {!!data.basics.name && (
              <StudioEditableText
                textId={"basics:name"}
                label={"姓名"}
                style={{
                  fontSize: 23,
                  fontWeight: 700,
                  lineHeight: 1.2,
                  color: "#f0dfb7",
                  letterSpacing: 1.2,
                }}
              >
                {data.basics.name}
              </StudioEditableText>
            )}
            {!!data.basics.headline && (
              <StudioEditableText
                textId={"basics:headline"}
                label={"求职方向"}
                style={{ fontSize: 10.5, marginTop: 5 }}
              >
                {data.basics.headline}
              </StudioEditableText>
            )}
            {!!contact.length && (
              <StudioContacts
                basics={data.basics}
                separator={"  ·  "}
                style={{ fontSize: 9.5, marginTop: 5 }}
              />
            )}
            {!!data.basics.website.url && (
              <StudioEditableText
                textId={"basics:website"}
                label={"网址"}
                style={{ fontSize: 9.5, marginTop: 3 }}
              >
                {safeStudioLink(data.basics.website.url) ? (
                  <Link
                    src={data.basics.website.url}
                    style={{ color: "#ffffff", textDecoration: "underline" }}
                  >
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
                style={{ fontSize: 9.5, marginTop: 2 }}
              >
                {field.link && safeStudioLink(field.link) ? (
                  <Link src={field.link} style={{ color: "#ffffff", textDecoration: "underline" }}>
                    {field.text}
                  </Link>
                ) : (
                  field.text
                )}
              </StudioEditableText>
            ))}
          </View>
        </View>
        <View style={{ paddingHorizontal: page.marginX, paddingTop: sectionGap + 3 }}>
          {sections.map((section, sectionIndex) => (
            <View
              key={section.id}
              break={section.startOnNewPage}
              data-resume-node={studioNodeKey(section.id)}
              style={{
                flexDirection: "row",
                gap: indexGap,
                paddingBottom: sectionIndex === sections.length - 1 ? 0 : sectionGap,
              }}
            >
              <View style={{ width: indexWidth, flexShrink: 0, flexDirection: "row", gap: 8 }}>
                <View style={{ width: 8, flexShrink: 0, alignItems: "center" }}>
                  {section.showHeading && (
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        marginTop: 4,
                        borderRadius: 4,
                        backgroundColor: color,
                      }}
                    />
                  )}
                  <View
                    style={{ width: 0.6, flexGrow: 1, backgroundColor: "#d1d8df", marginTop: 3 }}
                  />
                </View>
                {section.showHeading && (
                  <StudioEditableText
                    textId={`section:${section.id}:heading`}
                    label={`${section.title}标题`}
                    wrap={false}
                    style={{
                      width: indexWidth - 16,
                      fontFamily: typography.heading.fontFamily,
                      fontSize: Math.max(10.5, typography.heading.fontSize - 0.5),
                      fontWeight: 700,
                      color,
                      lineHeight: 1.4,
                    }}
                  >
                    {section.title}
                  </StudioEditableText>
                )}
              </View>
              <View style={{ width: entryWidth, flexShrink: 0 }}>
                {section.entries.map((entry, index) => (
                  <StudioEntryView
                    key={entry.id}
                    document={document}
                    section={section}
                    entry={entry}
                    width={entryWidth}
                    last={index === section.entries.length - 1}
                    color={color}
                    textColor={design.colors.text}
                    mutedColor="#526171"
                  />
                ))}
              </View>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}
