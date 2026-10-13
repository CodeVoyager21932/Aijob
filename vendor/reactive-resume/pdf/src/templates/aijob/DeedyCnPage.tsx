// Chinese Deedy layout: dyweb/Deedy-Resume-for-Chinese 3fe0e55a (Apache-2.0).
// Native semantic/field primitives: Reactive Resume 86a72bef (MIT).
// Original source and license: vendor/resume-template-references/deedy-cn/.
import type { Style } from "@react-pdf/types";
import type { TemplatePageProps } from "../../document";
import type { TemplateStyleSlots } from "../shared/types";
import { Page, View } from "#react-pdf-renderer";
import { rgbaStringToHex } from "@reactive-resume/utils/color";
import { useRender } from "../../context";
import { useRenderedSectionIds, useResolvedNode } from "../../semantic/context";
import { semanticNodeKeys } from "../../semantic/node-keys";
import { createBaseTemplateStyles } from "../shared/base-template-styles";
import { CustomFieldContactItem, EmailContactItem, LocationContactItem, PhoneContactItem, WebsiteContactItem } from "../shared/contact-item";
import { TemplateProvider } from "../shared/context";
import { filterSections } from "../shared/filtering";
import { getTemplateMetrics } from "../shared/metrics";
import { hasTemplatePicture } from "../shared/picture";
import { Heading, SemanticContactListView, SemanticHeaderPicture, SemanticHeaderView, SemanticRegionView, Text } from "../shared/primitives";
import { createRtlStyleHelpers } from "../shared/rtl";
import { Section } from "../shared/sections";
import { composeStyles } from "../shared/styles";

export const DeedyCnPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
  const data = useRender();
  const { metadata, basics, picture, rtl } = data;
  const pageNodeKey = semanticNodeKeys.page(pageNumber);
  const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
  const main = useRenderedSectionIds(pageNodeKey, filterSections(page.main, data));
  const side = useRenderedSectionIds(pageNodeKey, filterSections(page.sidebar, data));
  const metrics = getTemplateMetrics(metadata.page);
  const foreground = rgbaStringToHex(metadata.design.colors.text);
  const primary = rgbaStringToHex(metadata.design.colors.primary);
  const background = rgbaStringToHex(metadata.design.colors.background);
  const base = createBaseTemplateStyles({ metadata, foreground, background, picture, metrics, r: createRtlStyleHelpers(rtl) });
  const styles = {
    ...base,
    section: { flexDirection: "column", rowGap: 8 },
    sectionHeading: { fontSize: metadata.typography.heading.fontSize, lineHeight: 1.5, color: primary, fontWeight: 700 },
    item: { rowGap: 2 },
    sectionItemHeader: { rowGap: 2 },
    heading: { ...base.heading, fontSize: 12, color: foreground },
    icon: { display: metadata.page.hideIcons ? "none" : "flex", size: metadata.typography.body.fontSize, color: foreground },
  } satisfies TemplateStyleSlots;
  const contactStyle: Style = { flexDirection: "row", alignItems: "center", columnGap: 3 };
  return <Page {...semanticPageProps} size={semanticPageSize ?? pageSize}
    style={composeStyles(base.page, { paddingHorizontal: metrics.page.paddingHorizontal, paddingVertical: metrics.page.paddingVertical, rowGap: 14 }, pageMinHeightStyle, semanticPageStyle)}>
    <TemplateProvider pageNodeKey={pageNodeKey} styles={styles} colors={{ foreground, primary, background }}>
      {showHeader && <SemanticHeaderView style={{ alignItems: "center", borderBottomWidth: 0.4, borderBottomColor: primary, paddingBottom: 9, rowGap: 5 }}>
        <View style={{ flexDirection: "row", alignItems: "center", width: "100%", columnGap: 10 }}>
          <View style={{ flex: 1, alignItems: "center", rowGap: 4 }}>
            <Heading style={{ fontSize: 30, lineHeight: 1, textAlign: "center" }}>{basics.name}</Heading>
            <Text style={{ fontSize: 10, textAlign: "center" }}>{basics.headline}</Text>
          </View>
          {hasTemplatePicture(picture) && <SemanticHeaderPicture src={picture.url} style={base.picture} />}
        </View>
        <SemanticContactListView style={{ flexDirection: "row", justifyContent: "center", flexWrap: "wrap", columnGap: 8, rowGap: 3, fontSize: 11, color: primary }}>
          <EmailContactItem email={basics.email} style={contactStyle} />
          <PhoneContactItem phone={basics.phone} style={contactStyle} />
          <LocationContactItem location={basics.location} style={contactStyle} />
          <WebsiteContactItem website={basics.website} style={contactStyle} />
          {basics.customFields.map(field => <CustomFieldContactItem key={field.id} field={field} style={contactStyle} />)}
        </SemanticContactListView>
      </SemanticHeaderView>}
      <View style={{ flexDirection: "row", columnGap: metrics.columnGap }}>
        {!page.fullWidth && <SemanticRegionView region="sidebar" style={{ flexBasis: `${metadata.layout.sidebarWidth}%`, rowGap: metrics.sectionGap }}>
          {side.map(section => <Section key={section} section={section} placement="sidebar" />)}
        </SemanticRegionView>}
        <SemanticRegionView region="main" style={{ flex: 1, rowGap: metrics.sectionGap }}>
          {main.map(section => <Section key={section} section={section} placement="main" />)}
        </SemanticRegionView>
      </View>
    </TemplateProvider>
  </Page>;
};
