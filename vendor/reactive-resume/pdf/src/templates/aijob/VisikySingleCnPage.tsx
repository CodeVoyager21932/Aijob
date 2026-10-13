// Chinese adaptation: visiky/resume Template2 (2eb87e51, MIT) contact grid and trailing section rules.
// Native section components retain Reactive Resume MIT provenance.
import type { Style } from "@react-pdf/types";
import type { TemplatePageProps } from "../../document";
import type { TemplateColorRoles, TemplateStyleContext, TemplateStyleSlots } from "../shared/types";
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

type VisikySingleCnStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	picture: Style;
	headerTitle: Style;
	headerIdentity: Style;
	headerName: Style;
	contactList: Style;
	contactItem: Style;
	sectionGroup: Style;
};

type VisikySingleCnTemplate = {
	colors: TemplateColorRoles;
	styles: VisikySingleCnStyles;
};

type VisikySingleCnHeaderProps = {
	styles: VisikySingleCnStyles;
};

export const VisikySingleCnPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = useVisikySingleCnTemplate();
	const metrics = getTemplateMetrics(metadata.page);
	const mainSections = useRenderedSectionIds(pageNodeKey, filterSections(page.main, data));
	const sidebarSections = useRenderedSectionIds(pageNodeKey, filterSections(page.sidebar, data));

	return (
		<Page
			{...semanticPageProps}
			size={semanticPageSize ?? pageSize}
			style={composeStyles(styles.page, pageMinHeightStyle, semanticPageStyle)}
		>
			<TemplateProvider pageNodeKey={pageNodeKey} styles={styles} colors={colors} features={{ inlineItemHeader: true, sectionHeadingTrailingRule: true }}>
				{showHeader && <Header styles={styles} />}

				<SemanticRegionView region="main" style={composeStyles(styles.sectionGroup, { rowGap: metadata.page.sectionGap ?? 10 })}>
					{mainSections.map((section) => (
						<Section key={section} section={section} placement="main" />
					))}
				</SemanticRegionView>

				{!page.fullWidth && (
					<SemanticRegionView
						region="sidebar"
						style={composeStyles(styles.sectionGroup, { rowGap: metadata.page.sectionGap ?? 10 })}
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

const Header = ({ styles }: VisikySingleCnHeaderProps) => {
 const { basics, picture } = useRender();
 return <SemanticHeaderView style={styles.header}>
  <View style={styles.headerTitle}>
   <Heading style={styles.headerName}>{basics.name}</Heading>
   {basics.headline && <Text>{basics.headline}</Text>}
   <SemanticContactListView style={styles.contactList}>
    <PhoneContactItem phone={basics.phone} style={styles.contactItem} />
    <EmailContactItem email={basics.email} style={styles.contactItem} />
    <LocationContactItem location={basics.location} style={styles.contactItem} />
    <WebsiteContactItem website={basics.website} style={styles.contactItem} />
    {basics.customFields.map(field => <CustomFieldContactItem key={field.id} field={field} style={styles.contactItem} />)}
   </SemanticContactListView>
  </View>
  {hasTemplatePicture(picture) && <SemanticHeaderPicture src={picture.url} style={styles.picture} />}
 </SemanticHeaderView>;
};

const useVisikySingleCnTemplate = (): VisikySingleCnTemplate => {
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
				rowGap: 10,
			},
			section: {
				flexDirection: "column",
				rowGap: metrics.gapY(0.25),
			},
			item: {
				rowGap: metrics.gapY(0.125),
			},
			levelContainer: {
				width: "100%",
			},
			levelItem: {
				borderColor: primary,
			},
			levelItemActive: {
				backgroundColor: primary,
			},
			header: {
				flexDirection: r.row,
				alignItems: "center",
				columnGap: metrics.gapX(1),
				paddingBottom: 4,
			},
			headerTitle: {
				flex: 1,
				rowGap: metrics.gapY(0.5),
			},
			headerIdentity: {
				alignItems: "center",
                textAlign: "center",
				rowGap: metrics.gapY(0.35),
			},
			headerName: {
				fontSize: 18,
				lineHeight: headerNameLineHeight,
			},
			contactList: {
                justifyContent: "flex-start",
                fontSize: 10,
				flexDirection: r.row,
				flexWrap: "wrap",
				rowGap: metrics.gapY(0.125),
				columnGap: metrics.gapX(0.75),
			},
			contactItem: {
                width: "46%",
				flexDirection: r.row,
				alignItems: "center",
				columnGap: metrics.gapX(1 / 6),
			},
			sectionGroup: {},
            sectionHeadingContainer: { flexDirection: "row", alignItems: "center", columnGap: 12, marginBottom: 6 },
            sectionHeading: { fontSize: 12, lineHeight: 1.2, color: primary },
            picture: { width: 63, height: 63, objectFit: "cover", flexShrink: 0 },
            inlineItemHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", columnGap: 8 },
            inlineItemHeaderLeading: { flex: 1, fontWeight: 700 },
            inlineItemHeaderMiddle: { flex: 1 },
            inlineItemHeaderTrailing: { fontSize: 10, textAlign: "right" },
		});

		const accentFor = ({ colors }: TemplateStyleContext) => colors.primary;

		return {
			colors,
			styles: {
				...baseStyles,
				levelItem: (context) => ({ borderColor: accentFor(context) }),
				levelItemActive: (context) => ({ backgroundColor: accentFor(context) }),
				icon: (context) => ({
					display: metadata.page.hideIcons ? "none" : "flex",
					size: metadata.typography.body.fontSize,
					color: accentFor(context),
				}),
			} satisfies VisikySingleCnStyles,
		};
	}, [picture, metadata, rtl]);
};
