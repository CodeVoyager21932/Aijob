import type { NativeResumeDocument } from "@aijob/resume-core";
import { Document, Image, Link, Page, View } from "@aijob/resume-forme/primitives";
import { StudioContacts, StudioEditableText } from "./studio-editable-text.js";
import { StudioEntryView, safeStudioLink, studioNodeKey } from "./studio-entry.js";
import { studioSections } from "./studio-model.js";

/** Short identity banner and full-width chapters; personal content stays in normal flow. */
export function BannerDocument({ document }: { document: NativeResumeDocument }) {
  const { data } = document;
  const { page, typography, design } = data.metadata;
  const body = typography.body;
  const color = design.colors.primary;
  const contentWidth = 595.28 - page.marginX * 2;
  const photo = !data.picture.hidden && !!data.picture.url;
  const tight = (page.sectionGap ?? 8) <= 5;
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
          paddingHorizontal: page.marginX,
          paddingTop: page.marginY,
          paddingBottom: page.marginY,
          fontFamily: body.fontFamily,
          fontSize: body.fontSize,
          lineHeight: body.lineHeight,
          color: design.colors.text,
          backgroundColor: design.colors.background,
        }}
      >
        <View
          wrap={false}
          data-resume-node="page-1/header"
          style={{ flexDirection: "row", gap: photo ? 15 : 0, alignItems: "center" }}
        >
          {photo && (
            <Image
              src={data.picture.url}
              style={{ width: 60, height: 78, flexShrink: 0, objectFit: "cover" }}
            />
          )}
          <View
            style={{
              width: contentWidth - (photo ? 75 : 0),
              flexShrink: 0,
              minHeight: photo ? 88 : 76,
              paddingHorizontal: 17,
              paddingVertical: tight ? 10 : 12,
              justifyContent: "center",
              backgroundColor: color,
              borderBottomLeftRadius: 11,
              color: "#ffffff",
            }}
          >
            {!!data.basics.name && (
              <StudioEditableText
                textId={"basics:name"}
                label={"姓名"}
                style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.15 }}
              >
                {data.basics.name}
              </StudioEditableText>
            )}
            {!!data.basics.headline && (
              <StudioEditableText
                textId={"basics:headline"}
                label={"求职方向"}
                style={{ fontSize: Math.max(10, body.fontSize), marginTop: 4 }}
              >
                {data.basics.headline}
              </StudioEditableText>
            )}
            {contact.length > 0 && (
              <StudioContacts
                basics={data.basics}
                separator={"  ·  "}
                style={{ fontSize: Math.max(9.5, body.fontSize - 0.3), marginTop: 5 }}
              />
            )}
            {!!data.basics.website.url && (
              <StudioEditableText
                textId={"basics:website"}
                label={"网址"}
                style={{ fontSize: Math.max(9.5, body.fontSize - 0.3), marginTop: 3 }}
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
                style={{ fontSize: Math.max(9.5, body.fontSize - 0.3), marginTop: 2 }}
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
        {sections.map((section) => (
          <View
            key={section.id}
            break={section.startOnNewPage}
            data-resume-node={studioNodeKey(section.id)}
            style={{ marginTop: page.sectionGap ?? 8 }}
          >
            {section.showHeading && (
              <View
                wrap={false}
                style={{
                  backgroundColor: "#f6f2f2",
                  borderLeftWidth: 2.5,
                  borderLeftColor: color,
                  paddingLeft: 8,
                  paddingVertical: tight ? 2 : 3,
                  marginBottom: tight ? 3 : 4,
                }}
              >
                <StudioEditableText
                  textId={`section:${section.id}:heading`}
                  label={`${section.title}标题`}
                  style={{
                    fontFamily: typography.heading.fontFamily,
                    fontSize: typography.heading.fontSize,
                    fontWeight: 700,
                    lineHeight: 1.15,
                    color,
                  }}
                >
                  {section.title}
                </StudioEditableText>
              </View>
            )}
            {section.entries.map((entry, index) => (
              <StudioEntryView
                key={entry.id}
                document={document}
                section={section}
                entry={entry}
                width={contentWidth}
                color={color}
                last={index === section.entries.length - 1}
              />
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}
