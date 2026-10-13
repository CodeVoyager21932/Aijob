// Native adaptation of JobPilot Swiss at 69e6692 (Apache-2.0).
// Retains its left date column, role-first entry hierarchy and separated contact band.
// Native semantic/page primitives: Reactive Resume 86a72bef (MIT).
import type { Style } from "@react-pdf/types";
import type { TemplatePageProps } from "../../document";
import type { TemplateColorRoles, TemplateFeatures, TemplateStyleContext, TemplateStyleSlots } from "../shared/types";
import { useMemo } from "react";
import { rgbaStringToHex } from "@reactive-resume/utils/color";
import { Page, StyleSheet, View } from "#react-pdf-renderer";
import { useRender } from "../../context";
import { useRenderedSectionIds, useResolvedNode } from "../../semantic/context";
import { semanticNodeKeys } from "../../semantic/node-keys";
import { createBaseTemplateStyles } from "../shared/base-template-styles";
import {
	CustomFieldContactItem,
	EmailContactItem,
	LocationContactItem,
	PhoneContactItem,
	WebsiteContactItem,
} from "../shared/contact-item";
import { TemplateProvider } from "../shared/context";
import { filterSections } from "../shared/filtering";
import { getTemplateMetrics } from "../shared/metrics";
import { hasTemplatePicture } from "../shared/picture";
import {
	Heading,
	SemanticContactListView,
	SemanticHeaderPicture,
	SemanticHeaderView,
	SemanticRegionView,
	Text,
} from "../shared/primitives";
import { createRtlStyleHelpers } from "../shared/rtl";
import { Section } from "../shared/sections";
import { composeStyles, headerNameLineHeight } from "../shared/styles";

type SwissCnStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	headerTitle: Style;
	headerIdentity: Style;
	headerName: Style;
	headerHeadline: Style;
	contactList: Style;
	contactItem: Style;
	picture: Style;
	sectionGroup: Style;
};

type SwissCnTemplate = {
	colors: TemplateColorRoles;
	styles: SwissCnStyles;
};

type SwissCnHeaderProps = {
	styles: SwissCnStyles;
};

const swissCnFeatures = {
	inlineItemHeader: true,
} satisfies TemplateFeatures;

export const SwissCnPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = useSwissCnTemplate();
	const metrics = getTemplateMetrics(metadata.page);
	const mainSections = useRenderedSectionIds(pageNodeKey, filterSections(page.main, data));
	const sidebarSections = useRenderedSectionIds(pageNodeKey, filterSections(page.sidebar, data));

	return (
		<Page
			{...semanticPageProps}
			size={semanticPageSize ?? pageSize}
			style={composeStyles(styles.page, pageMinHeightStyle, semanticPageStyle)}
		>
			<TemplateProvider pageNodeKey={pageNodeKey} styles={styles} colors={colors} features={swissCnFeatures}>
				{showHeader && <Header styles={styles} />}

				<SemanticRegionView region="main" style={composeStyles(styles.sectionGroup, { rowGap: metrics.sectionGap })}>
					{mainSections.map((section) => (
						<SwissSection key={section} section={section} pageNodeKey={pageNodeKey} styles={styles} colors={colors} />
					))}
				</SemanticRegionView>

				{!page.fullWidth && (
					<SemanticRegionView
						region="sidebar"
						style={composeStyles(styles.sectionGroup, { rowGap: metrics.sectionGap })}
					>
						{sidebarSections.map((section) => (
							<Section key={section} section={section} placement="sidebar" />
						))}
					</SemanticRegionView>
				)}
			</TemplateProvider>
		</Page>
	);
};

const Header = ({ styles }: SwissCnHeaderProps) => {
 const { basics, picture } = useRender();
 return <SemanticHeaderView style={styles.header}>
  <View style={{flexDirection:"row", columnGap:18, alignItems:"flex-start"}}>
   {hasTemplatePicture(picture) && <SemanticHeaderPicture src={picture.url} style={styles.picture} />}
   <View style={styles.headerIdentity}>
    <Heading style={styles.headerName}>{basics.name}</Heading>
    {basics.headline && <Text style={styles.headerHeadline}>{basics.headline}</Text>}
   </View>
  </View>
  <SemanticContactListView style={styles.contactList}>
   <EmailContactItem email={basics.email} style={styles.contactItem} />
   <PhoneContactItem phone={basics.phone} style={styles.contactItem} />
   <LocationContactItem location={basics.location} style={styles.contactItem} />
   <WebsiteContactItem website={basics.website} style={styles.contactItem} />
   {basics.customFields.map(field => <CustomFieldContactItem key={field.id} field={field} style={styles.contactItem} />)}
  </SemanticContactListView>
 </SemanticHeaderView>;
};

// The upstream grid reserves the date column for dated records; introductory
// prose and contact-like sections use the full measure. Skills put the category
// in that column and the actual use on the right, rather than indenting both.
const SwissSection = ({ section, pageNodeKey, styles, colors }: {
 section: string; pageNodeKey: string; styles: SwissCnStyles; colors: TemplateColorRoles;
}) => {
 const data = useRender();
 const custom = data.customSections.find(item => item.id === section);
 const type = custom?.type ?? section;
 const dated = ["education", "experience", "projects", "publications", "certifications", "awards", "volunteer"].includes(type);
 const skill = type === "skills";
 const scoped: SwissCnStyles = {
  ...styles,
  item: dated ? styles.item : { rowGap: 3, paddingLeft: 0, ...(skill ? { flexDirection: "row", columnGap: 12 } : {}) },
  ...(skill ? { sectionItemHeader: { width: 88, flexShrink: 0 } } : {}),
 };
 return <TemplateProvider pageNodeKey={pageNodeKey} styles={scoped} colors={colors} features={swissCnFeatures}>
  <Section section={section} placement="main" />
 </TemplateProvider>;
};

const useSwissCnTemplate = (): SwissCnTemplate => {
	const { picture, metadata, rtl } = useRender();

	return useMemo(() => {
		const r = createRtlStyleHelpers(rtl);
		const foreground = rgbaStringToHex(metadata.design.colors.text);
		const background = rgbaStringToHex(metadata.design.colors.background);
		const primary = rgbaStringToHex(metadata.design.colors.primary);
		const colors: TemplateColorRoles = { foreground, background, primary };
		const metrics = getTemplateMetrics(metadata.page);
		const base = createBaseTemplateStyles({ metadata, foreground, background, r, metrics, picture });

		const baseStyles = StyleSheet.create({
			...base,
			page: {
				...base.page,
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingVertical: metrics.page.paddingVertical,
				rowGap: metrics.sectionGap,
			},
            inlineItemHeader: { flexDirection: "column", rowGap: 3, position: "relative" },
            inlineItemHeaderLeading: { minWidth: 0, fontWeight: 700 },
            inlineItemHeaderMiddle: { minWidth: 0, color: primary },
            inlineItemHeaderTrailing: { position: "absolute", top: 0, left: 0, width: 88 },
            alignEnd: { position: "absolute", top: 0, left: -100, width: 88, textAlign: "left", fontSize: 9, color: "#52525b" },
			section: {
				flexDirection: "column",
				rowGap: metrics.gapY(0.25),
			},
            sectionHeading: { color: foreground, borderLeftWidth: 6, borderLeftColor: primary,
                paddingLeft: 8, borderBottomWidth: 0.5, borderBottomColor: "#d4d4d8", paddingBottom: 5,
                marginBottom: 7, fontSize: 11, letterSpacing: 0.4 },
            item: { rowGap: 3, paddingLeft: 100, position: "relative" },
			levelContainer: {
				width: "100%",
			},
			levelItem: {
				borderColor: primary,
			},
			levelItemActive: {
				backgroundColor: primary,
			},
            header: { flexDirection: "column", rowGap: 14 },
            headerTitle: { flex: 1 },
            headerIdentity: { flex: 1, rowGap: 5 },
            headerName: { fontSize: 24, color: foreground, lineHeight: headerNameLineHeight },
            headerHeadline: { fontSize: 10, color: "#52525b", letterSpacing: 1 },
            picture: { ...base.picture, width: 48, height: 48 },
            contactList: { flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 4,
                paddingTop: 9, borderTopWidth: 1, borderTopColor: foreground, fontSize: 9 },
			contactItem: {
				flexDirection: r.row,
				alignItems: "center",
				columnGap: metrics.gapX(1 / 6),
			},
			sectionGroup: {},
		});

		const accentFor = ({ colors }: TemplateStyleContext) => colors.primary;

		return {
			colors,
			styles: {
				...baseStyles,
				sectionHeading: (context) => ({
					...baseStyles.sectionHeading,
					borderLeftColor: accentFor(context),
				}),
				levelItem: (context) => ({ borderColor: accentFor(context) }),
				levelItemActive: (context) => ({ backgroundColor: accentFor(context) }),
				icon: (context) => ({
					display: metadata.page.hideIcons ? "none" : "flex",
					size: metadata.typography.body.fontSize,
					color: accentFor(context),
				}),
			} satisfies SwissCnStyles,
		};
	}, [picture, metadata, rtl]);
};
