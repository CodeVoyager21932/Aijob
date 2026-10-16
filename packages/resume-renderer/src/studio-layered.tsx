import type { NativeResumeDocument } from "@aijob/resume-core";
import { Document, Image, Link, Page, Text, View } from "@aijob/resume-forme/primitives";
import { StudioContacts, StudioEditableText } from "./studio-editable-text.js";
import { StudioEntryView, safeStudioLink, studioNodeKey } from "./studio-entry.js";
import { studioSections } from "./studio-model.js";

/** The photograph bridges a small identity card; all sections share one continuous body panel. */
export function LayeredDocument({ document }: { document: NativeResumeDocument }) {
  const { data } = document;
  const { page, typography, design } = data.metadata;
  const body = typography.body;
  const color = design.colors.primary;
  const contentWidth = 595.28 - page.marginX * 2;
  const panelInset = (page.sectionGap ?? 8) <= 5 ? 8 : 12;
  const entryWidth = contentWidth - panelInset * 2;
  const sectionGap = page.sectionGap ?? 8;
  const photo = !data.picture.hidden && !!data.picture.url;
  const contact = [data.basics.phone, data.basics.email, data.basics.location].filter(Boolean);
  const headerFields = [
    ...(data.basics.website.url
      ? [
          {
            id: "website",
            text: data.basics.website.label || data.basics.website.url,
            url: data.basics.website.url,
          },
        ]
      : []),
    ...data.basics.customFields.map((field) => ({
      id: `custom:${field.id}`,
      text: field.text,
      url: field.link,
    })),
  ];
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
          paddingTop: Math.min(page.marginY, 18),
          paddingBottom: page.marginY,
          fontFamily: body.fontFamily,
          fontSize: Math.max(9.5, body.fontSize),
          lineHeight: body.lineHeight,
          color: design.colors.text,
          backgroundColor: "#f1f3fa",
        }}
      >
        <View
          wrap={false}
          data-resume-node="page-1/header"
          style={{ minHeight: photo ? 101 : 85, paddingBottom: photo ? 15 : 9 }}
        >
          {!photo && (
            <View
              style={{
                position: "absolute",
                left: 0,
                right: 7,
                top: 7,
                bottom: 3,
                borderRadius: 7,
                backgroundColor: "#dce5f5",
              }}
            />
          )}
          <View
            style={{
              marginLeft: photo ? 35 : 7,
              paddingLeft: photo ? 44 : 16,
              paddingRight: 16,
              paddingVertical: headerFields.length ? 8 : 11,
              minHeight: 78,
              borderRadius: 7,
              backgroundColor: color,
              color: "#ffffff",
            }}
          >
            {!!data.basics.name && (
              <StudioEditableText
                textId={"basics:name"}
                label={"姓名"}
                style={{ fontSize: 23, fontWeight: 700, lineHeight: 1.2, letterSpacing: 0.8 }}
              >
                {data.basics.name}
              </StudioEditableText>
            )}
            {!!data.basics.headline && (
              <StudioEditableText
                textId={"basics:headline"}
                label={"求职方向"}
                style={{ fontSize: 10.5, marginTop: 4 }}
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
            {!!headerFields.length && (
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "baseline",
                  fontSize: 9.5,
                  marginTop: 3,
                }}
              >
                {headerFields.map((field, index) => (
                  <View key={field.id} style={{ flexDirection: "row", alignItems: "baseline" }}>
                    {index > 0 && <Text>{"  ·  "}</Text>}
                    <StudioEditableText
                      textId={`basics:${field.id}`}
                      label={field.id === "website" ? "网址" : "自定义联系方式"}
                    >
                      {field.url && safeStudioLink(field.url) ? (
                        <Link
                          src={field.url}
                          style={{ color: "#ffffff", textDecoration: "underline" }}
                        >
                          {field.text}
                        </Link>
                      ) : (
                        field.text
                      )}
                    </StudioEditableText>
                  </View>
                ))}
              </View>
            )}
          </View>
          {photo && (
            <View
              style={{
                position: "absolute",
                left: 0,
                top: 17,
                padding: 3,
                backgroundColor: "#ffffff",
                borderWidth: 0.6,
                borderColor: "#dce1ed",
                borderRadius: 5,
              }}
            >
              <Image
                src={data.picture.url}
                style={{ width: 58, height: 70, objectFit: "cover", borderRadius: 2 }}
              />
            </View>
          )}
        </View>
        <View
          style={{
            backgroundColor: "#ffffff",
            borderRadius: 8,
            paddingHorizontal: panelInset,
            paddingTop: 9,
            paddingBottom: 11,
          }}
        >
          {sections.map((section, sectionIndex) => (
            <View
              key={section.id}
              break={section.startOnNewPage}
              data-resume-node={studioNodeKey(section.id)}
              style={{ marginTop: sectionIndex ? sectionGap : 0 }}
            >
              {section.showHeading && (
                <View
                  wrap={false}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}
                >
                  <View style={{ width: 4, height: 12, borderRadius: 2, backgroundColor: color }} />
                  <StudioEditableText
                    textId={`section:${section.id}:heading`}
                    label={`${section.title}标题`}
                    style={{
                      fontFamily: typography.heading.fontFamily,
                      fontSize: typography.heading.fontSize,
                      fontWeight: 700,
                      color,
                      lineHeight: 1.3,
                    }}
                  >
                    {section.title}
                  </StudioEditableText>
                  <View style={{ flexGrow: 1, height: 0.6, backgroundColor: "#dbe2ef" }} />
                </View>
              )}
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
                  mutedColor="#56627b"
                />
              ))}
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}
