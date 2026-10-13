// JobPilot Euro 69e6692 (Apache-2.0): labelled contact rows and section index.
// Native page, semantic and content primitives from Reactive Resume 86a72bef (MIT).
import type { Style } from "@react-pdf/types";
import type { TemplatePageProps } from "../../document";
import type { TemplateColorRoles, TemplateStyleSlots } from "../shared/types";
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

type EuroCnStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	picture: Style;
	headerTitle: Style;
	headerIdentity: Style;
	headerName: Style;
	headerContactRow: Style;
	headerContactItem: Style;
	sections: Style;
};

type EuroCnTemplate = {
	colors: TemplateColorRoles;
	styles: EuroCnStyles;
};

type EuroCnHeaderProps = {
	styles: EuroCnStyles;
};

const getEuroCnSections = ({
	mainSections,
	sidebarSections,
	fullWidth,
}: {
	mainSections: string[];
	sidebarSections: string[];
	fullWidth: boolean;
}) => {
	if (fullWidth) return mainSections;

	const sections: string[] = [];
	const sectionCount = Math.max(mainSections.length, sidebarSections.length);

	for (let index = 0; index < sectionCount; index += 1) {
		const sidebarSection = sidebarSections[index];
		const mainSection = mainSections[index];

		if (sidebarSection) sections.push(sidebarSection);
		if (mainSection) sections.push(mainSection);
	}

	return sections;
};

export const EuroCnPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { styles, colors } = useEuroCnTemplate();
	const metrics = getTemplateMetrics(metadata.page);
	const sidebarSections = useRenderedSectionIds(pageNodeKey, filterSections(page.sidebar, data));
	const mainSections = useRenderedSectionIds(pageNodeKey, filterSections(page.main, data));
	const sections = getEuroCnSections({ mainSections, sidebarSections, fullWidth: page.fullWidth });

	return (
		<Page
			{...semanticPageProps}
			size={semanticPageSize ?? pageSize}
			style={composeStyles(styles.page, pageMinHeightStyle, semanticPageStyle)}
		>
			<TemplateProvider pageNodeKey={pageNodeKey} styles={styles} colors={colors}>
				{showHeader && <Header styles={styles} />}

				<SemanticRegionView region="main" style={composeStyles(styles.sections, { rowGap: metrics.sectionGap })}>
					{sections.map((section) => (
						<Section key={section} section={section} placement="main" />
					))}
				</SemanticRegionView>
			</TemplateProvider>
		</Page>
	);
};

const Header = ({ styles }: EuroCnHeaderProps) => {
 const { basics,picture }=useRender();
 const labelStyle={width:72,fontSize:9,color:"#71717a"};
 return <SemanticHeaderView style={styles.header}>
  <View style={{flex:1,rowGap:6}}>
   <Heading style={styles.headerName}>{basics.name}</Heading>
   {basics.headline && <Text>{basics.headline}</Text>}
   <SemanticContactListView style={styles.headerContactRow}>
    {basics.email && <View style={styles.headerContactItem}><Text style={labelStyle}>邮箱</Text><EmailContactItem email={basics.email} /></View>}
    {basics.phone && <View style={styles.headerContactItem}><Text style={labelStyle}>电话</Text><PhoneContactItem phone={basics.phone} /></View>}
    {basics.location && <View style={styles.headerContactItem}><Text style={labelStyle}>城市</Text><LocationContactItem location={basics.location} /></View>}
    {basics.website.url && <View style={styles.headerContactItem}><Text style={labelStyle}>主页</Text><WebsiteContactItem website={basics.website} /></View>}
    {basics.customFields.map(field=><View key={field.id} style={styles.headerContactItem}><Text style={labelStyle}>其他链接</Text><CustomFieldContactItem field={field} /></View>)}
   </SemanticContactListView>
  </View>
  {hasTemplatePicture(picture) && <SemanticHeaderPicture src={picture.url} style={styles.picture} />}
 </SemanticHeaderView>;
};

const useEuroCnTemplate = (): EuroCnTemplate => {
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
			heading: { ...base.heading, fontWeight: metadata.typography.heading.fontWeights[0] ?? "500" },
			page: {
				...base.page,
				flexDirection: "column",
				rowGap: metrics.headerGap,
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingVertical: metrics.page.paddingVertical,
			},
			section: {
				flexDirection: r.row,
				columnGap: 12,
				borderTopWidth: 0,
				borderTopColor: primary,
				paddingTop: 0,
			},
			sectionHeading: {
				width: 84,
				flexShrink: 0,
				fontSize: 10,
				color: primary,
				textAlign: "right",
			},
			sectionItems: {
                borderLeftWidth: 1.5, borderLeftColor: "#dbeafe", paddingLeft: 12,
				flex: 1,
			},
			sections: {
				flexDirection: "column",
			},
			picture: {width:66,height:66,objectFit:"cover",borderWidth:1.5,borderColor:primary},
            header: {
                flexDirection:"row",columnGap:18,paddingBottom:18,borderBottomWidth:3,borderBottomColor:primary,				alignItems: "flex-start",
				rowGap: metrics.gapY(0.5),
			},
			headerTitle: {
				alignItems: "flex-start",
				textAlign: "center",
			},
			headerIdentity: {
				alignItems: "flex-start",
				textAlign: "center",
				rowGap: metrics.gapY(0.35),
			},
			headerName: {
				fontSize: 22.5, color: primary,
				lineHeight: headerNameLineHeight,
			},
			headerContactRow: {
                marginTop:3,				justifyContent: "flex-start",
				flexDirection: "column",
				
				rowGap: metrics.gapY(0.125),
				columnGap: metrics.gapX(5 / 6),
			},
			headerContactItem: {
				flexDirection: r.row,
				alignItems: "flex-start",
				columnGap: metrics.gapX(0.25),
			},
			icon: {
				display: metadata.page.hideIcons ? "none" : "flex",
				size: metadata.typography.body.fontSize,
				color: primary,
			},
		});

		return { colors, styles: baseStyles satisfies EuroCnStyles };
	}, [picture, metadata, rtl]);
};
