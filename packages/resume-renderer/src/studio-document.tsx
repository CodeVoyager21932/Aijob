import type { NativeResumeDocument } from "@aijob/resume-core";
import { Document, Image, Link, Page, Text, View } from "@aijob/resume-forme/primitives";
import { BannerDocument } from "./studio-banner.js";
import { CampusDocument } from "./studio-campus.js";
import { CardsDocument } from "./studio-cards.js";
import { IndexedDocument } from "./studio-indexed.js";
import { LayeredDocument } from "./studio-layered.js";
import { type StudioEntry, type StudioSection, studioSections } from "./studio-model.js";
import { richBlocks } from "./studio-rich-text.js";
import { SidebarDocument } from "./studio-sidebar.js";

const safeLink = (url: string) => /^(https?:\/\/|mailto:|tel:)/i.test(url);
const nodeKey = (sectionId: string, itemId?: string) =>
  `page-1/region-main/section-${encodeURIComponent(sectionId)}${itemId ? `/section-items/item-${encodeURIComponent(itemId)}` : ""}`;

export function StudioDocument({ document }: { document: NativeResumeDocument }) {
  if (document.presentation?.id === "studio-campus-cn")
    return <CampusDocument document={document} />;
  if (document.presentation?.id === "studio-banner-cn")
    return <BannerDocument document={document} />;
  if (document.presentation?.id === "studio-sidebar-cn")
    return <SidebarDocument document={document} />;
  if (document.presentation?.id === "studio-index-cn")
    return <IndexedDocument document={document} />;
  if (document.presentation?.id === "studio-layered-cn")
    return <LayeredDocument document={document} />;
  if (document.presentation?.id === "studio-cards-cn") return <CardsDocument document={document} />;
  const { data, presentation } = document;
  const id = presentation?.id;
  const compact = id === "studio-compact-cn",
    twoColumns = id === "studio-main-cn";
  const research = id === "studio-research-cn";
  const body = data.metadata.typography.body;
  const tight = (data.metadata.page.sectionGap ?? 14) <= 8;
  const contentWidth = 595.28 - data.metadata.page.marginX * 2;
  const columnGap = data.metadata.page.gapX;
  const sideWidth = ((contentWidth - columnGap) * data.metadata.layout.sidebarWidth) / 100;
  const mainWidth = contentWidth - columnGap - sideWidth;
  const sectionGap = data.metadata.page.sectionGap ?? (compact ? 9 : 14);
  const color = data.metadata.design.colors.primary;
  const sections = studioSections(document);
  const sideIds = new Set(data.metadata.layout.pages.flatMap((page) => page.sidebar));
  const renderEntry = (entry: StudioEntry, sectionId: string) => {
    const blocks = entry.bodies.flatMap(richBlocks);
    return (
      <View
        key={entry.id}
        data-resume-node={nodeKey(sectionId, entry.id)}
        style={{ marginBottom: data.metadata.page.gapY }}
      >
        {(entry.title || entry.date || entry.details.length > 0) && (
          <View wrap={false}>
            <View style={{ flexDirection: "row", gap: 12, alignItems: "baseline" }}>
              <Text style={{ flexGrow: 1, flexShrink: 1, fontWeight: 700 }}>{entry.title}</Text>
              {entry.date && (
                <Text
                  style={{ fontSize: body.fontSize - 0.5, maxWidth: "42%", textAlign: "right" }}
                >
                  {entry.date}
                </Text>
              )}
            </View>
            {entry.details.length > 0 && (
              <Text style={{ fontSize: body.fontSize - 0.3, color: "#47515a", marginTop: 2 }}>
                {entry.details
                  .map((detail) => `${detail.label ? `${detail.label}：` : ""}${detail.text}`)
                  .join(" · ")}
              </Text>
            )}
          </View>
        )}
        {blocks.map((block, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a disposable PDF render has no persistent component state.
          <Text key={index} orphans={2} widows={2} style={{ marginTop: tight ? 1 : 2 }}>
            {block}
          </Text>
        ))}
        {entry.links.map((link) => (
          <Text key={link.url} style={{ marginTop: 2, fontSize: body.fontSize - 0.5 }}>
            {safeLink(link.url) ? (
              <Link src={link.url} style={{ color, textDecoration: "underline" }}>
                {link.label}
              </Link>
            ) : (
              link.label
            )}
          </Text>
        ))}
      </View>
    );
  };
  const renderSection = (section: StudioSection, number: number) => (
    <View
      key={section.id}
      break={section.startOnNewPage}
      data-resume-node={nodeKey(section.id)}
      style={{ marginTop: sectionGap }}
    >
      {section.showHeading && (
        <Text
          wrap={false}
          style={{
            fontSize: data.metadata.typography.heading.fontSize,
            fontFamily: data.metadata.typography.heading.fontFamily,
            fontWeight: 700,
            color,
            borderBottomWidth: research ? 0.5 : 1,
            borderBottomColor: color,
            paddingBottom: 3,
            marginBottom: tight ? 3 : compact ? 4 : 7,
          }}
        >
          {research ? `${String(number + 1).padStart(2, "0")}  ` : ""}
          {section.title}
        </Text>
      )}
      {section.entries.map((entry) => renderEntry(entry, section.id))}
    </View>
  );
  const contact = [data.basics.email, data.basics.phone, data.basics.location].filter(Boolean);
  const header = (
    <View
      data-resume-node="page-1/header"
      wrap={false}
      style={{
        paddingBottom: compact ? 4 : 9,
        borderBottomWidth: research ? 0 : 1.5,
        borderBottomColor: color,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
        <View style={{ flexGrow: 1, flexShrink: 1 }}>
          <Text style={{ fontSize: compact ? 23 : 26, fontWeight: 700, lineHeight: 1.2, color }}>
            {data.basics.name}
          </Text>
          {!!data.basics.headline && (
            <Text style={{ fontSize: 11, marginTop: 5 }}>{data.basics.headline}</Text>
          )}
          {!!contact.length && (
            <Text style={{ fontSize: 9, marginTop: 5 }}>{contact.join("  ·  ")}</Text>
          )}
          {!!data.basics.website.url && (
            <Text style={{ fontSize: 9, marginTop: 3 }}>
              <Link src={data.basics.website.url}>
                {data.basics.website.label || data.basics.website.url}
              </Link>
            </Text>
          )}
          {data.basics.customFields.map((field) => (
            <Text key={field.id} style={{ fontSize: 9, marginTop: 2 }}>
              {field.link && safeLink(field.link) ? (
                <Link src={field.link}>{field.text}</Link>
              ) : (
                field.text
              )}
            </Text>
          ))}
        </View>
        {!data.picture.hidden && data.picture.url && (
          <Image src={data.picture.url} style={{ width: 54, height: 70, objectFit: "cover" }} />
        )}
      </View>
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
          paddingHorizontal: data.metadata.page.marginX,
          paddingVertical: data.metadata.page.marginY,
          fontFamily: body.fontFamily,
          fontSize: body.fontSize,
          lineHeight: body.lineHeight,
          color: data.metadata.design.colors.text,
        }}
      >
        {header}
        {twoColumns ? (
          <View style={{ flexDirection: "row", gap: columnGap, width: contentWidth }}>
            <View style={{ width: mainWidth, flexShrink: 0 }}>
              {sections.filter((section) => !sideIds.has(section.id)).map(renderSection)}
            </View>
            <View style={{ width: sideWidth, flexShrink: 0 }}>
              {sections.filter((section) => sideIds.has(section.id)).map(renderSection)}
            </View>
          </View>
        ) : (
          sections.map(renderSection)
        )}
      </Page>
    </Document>
  );
}
