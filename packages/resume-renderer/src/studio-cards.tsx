import type { NativeResumeDocument } from "@aijob/resume-core";
import { Document, Image, Link, Page, Text, View } from "@aijob/resume-forme/primitives";
import { StudioContacts, StudioEditableText } from "./studio-editable-text.js";
import { StudioEntryView, safeStudioLink, studioNodeKey } from "./studio-entry.js";
import { studioSections } from "./studio-model.js";

/** Separate rounded chapter cards, with compact internal spacing and a quiet identity header. */
export function CardsDocument({ document }: { document: NativeResumeDocument }) {
  const { data } = document;
  const { page, typography, design } = data.metadata;
  const body = typography.body;
  const color = design.colors.primary;
  const contentWidth = 595.28 - page.marginX * 2;
  const sectionGap = page.sectionGap ?? 8;
  const tight = sectionGap <= 5;
  const cardInset = tight ? 7 : 11;
  const entryWidth = contentWidth - cardInset * 2 - 1;
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
          paddingTop: 15,
          paddingBottom: page.marginY,
          fontFamily: body.fontFamily,
          fontSize: Math.max(9.5, body.fontSize),
          lineHeight: body.lineHeight,
          color: design.colors.text,
          backgroundColor: "#f0f6f3",
        }}
      >
        <View
          style={{
            height: 4,
            width: 595.28,
            marginLeft: -page.marginX,
            marginTop: -15,
            marginBottom: 11,
            backgroundColor: color,
            flexShrink: 0,
          }}
        />
        <View
          wrap={false}
          data-resume-node="page-1/header"
          style={{
            minHeight: photo ? 81 : 76,
            flexDirection: "row",
            alignItems: "center",
            gap: 18,
            paddingBottom: 9,
          }}
        >
          <View style={{ flexGrow: 1, flexShrink: 1 }}>
            {!!data.basics.name && (
              <StudioEditableText
                textId={"basics:name"}
                label={"姓名"}
                style={{
                  fontFamily: typography.heading.fontFamily,
                  fontSize: 23,
                  fontWeight: 700,
                  color,
                  lineHeight: 1.2,
                  letterSpacing: 0.8,
                }}
              >
                {data.basics.name}
              </StudioEditableText>
            )}
            {!!data.basics.headline && (
              <StudioEditableText
                textId={"basics:headline"}
                label={"求职方向"}
                style={{ fontSize: 10.5, marginTop: 4, color: "#3f5f55" }}
              >
                {data.basics.headline}
              </StudioEditableText>
            )}
            {!!contact.length && (
              <StudioContacts
                basics={data.basics}
                separator={"  ·  "}
                style={{ fontSize: 9.5, marginTop: 5, color: "#52685f" }}
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
                  color: "#52685f",
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
                        <Link src={field.url} style={{ color, textDecoration: "underline" }}>
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
                padding: 3,
                borderRadius: 4,
                backgroundColor: "#ffffff",
                borderWidth: 0.5,
                borderColor: "#d4e2da",
              }}
            >
              <Image
                src={data.picture.url}
                style={{ width: 51, height: 65, objectFit: "cover", borderRadius: 2 }}
              />
            </View>
          )}
        </View>
        {sections.map((section, sectionIndex) => (
          <View
            key={section.id}
            break={section.startOnNewPage}
            data-resume-node={studioNodeKey(section.id)}
            style={{
              marginTop: sectionIndex ? sectionGap : 0,
              paddingHorizontal: cardInset,
              paddingTop: tight ? 5 : 7,
              paddingBottom: tight ? 6 : 8,
              borderWidth: 0.5,
              borderColor: "#dee9e2",
              borderRadius: 7,
              backgroundColor: "#ffffff",
            }}
          >
            {section.showHeading && (
              <StudioEditableText
                textId={`section:${section.id}:heading`}
                label={`${section.title}标题`}
                wrap={false}
                style={{
                  fontFamily: typography.heading.fontFamily,
                  fontSize: typography.heading.fontSize,
                  fontWeight: 700,
                  color,
                  lineHeight: 1.3,
                  borderBottomWidth: 0.5,
                  borderBottomColor: "#deebe3",
                  paddingBottom: tight ? 2 : 3,
                  marginBottom: tight ? 3 : 4,
                }}
              >
                {section.title}
              </StudioEditableText>
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
                mutedColor="#52685f"
              />
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}
