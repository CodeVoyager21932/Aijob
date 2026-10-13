// Native adaptation of jlifeng/JobPilot 69e6692 (Apache-2.0); native primitives MIT.
// Fixed source config/components: vendor/resume-template-references/jobpilot/source.json.
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
import { composeStyles } from "../shared/styles";

type JpAcademicCnStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	picture: Style;
	headerTitle: Style;
	headerName: Style;
	contactList: Style;
	contactItem: Style;
	sectionGroup: Style;
};

type JpAcademicCnTemplate = {
	colors: TemplateColorRoles;
	styles: JpAcademicCnStyles;
};

type JpAcademicCnHeaderProps = {
	styles: JpAcademicCnStyles;
};

export const JpAcademicCnPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = useJpAcademicCnTemplate();
	const metrics = getTemplateMetrics(metadata.page);
	const mainSections = useRenderedSectionIds(pageNodeKey, filterSections(page.main, data));
	const sidebarSections = useRenderedSectionIds(pageNodeKey, filterSections(page.sidebar, data));

	return (
		<Page
			{...semanticPageProps}
			size={semanticPageSize ?? pageSize}
			style={composeStyles(styles.page, pageMinHeightStyle, semanticPageStyle)}
		>
			<TemplateProvider pageNodeKey={pageNodeKey} styles={styles} colors={colors}>
				{showHeader && <Header styles={styles} />}

				<SemanticRegionView region="main" style={composeStyles(styles.sectionGroup, { rowGap: metadata.page.sectionGap ?? 10 })}>
					{mainSections.map((section) => (
						<TemplateSection key={section} section={section} pageNodeKey={pageNodeKey} styles={styles} colors={colors} />
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

const Header=({styles}:JpAcademicCnHeaderProps)=>{
 const {basics,picture}=useRender();const photo=hasTemplatePicture(picture);
 return <SemanticHeaderView style={styles.header}>
 <View style={{flexDirection:"row",alignItems:"center",columnGap:12}}>
 {photo&&<SemanticHeaderPicture src={picture.url} style={styles.picture}/>}
 <View style={{flex:1,textAlign:photo?"left":"center",rowGap:3}}><Heading style={styles.headerName}>{basics.name}</Heading>
 {basics.headline&&<Text style={{fontSize:12}}>{basics.headline}</Text>}<SemanticContactListView style={styles.contactList}>
 <PhoneContactItem phone={basics.phone} style={styles.contactItem}/><EmailContactItem email={basics.email} style={styles.contactItem}/>
 <LocationContactItem location={basics.location} style={styles.contactItem}/><WebsiteContactItem website={basics.website} style={styles.contactItem}/>
 {basics.customFields.map(field=><CustomFieldContactItem key={field.id} field={field} style={styles.contactItem}/>)}
 </SemanticContactListView></View>
 </View></SemanticHeaderView>;
};
const TemplateSection=({section,pageNodeKey,styles,colors}:{section:string;pageNodeKey:string;styles:JpAcademicCnStyles;colors:TemplateColorRoles})=>{
 const data=useRender();const kind=data.customSections.find(item=>item.id===section)?.type??section;
 const inline=["education","experience"].includes(kind);
 const scoped=true && kind==="education" ? {...styles,inlineItemHeader:{flexDirection:"column" as const,position:"relative" as const,paddingRight:120,rowGap:3},inlineItemHeaderLeading:{fontWeight:700},inlineItemHeaderMiddle:{},inlineItemHeaderTrailing:{position:"absolute" as const,right:0,top:0}} : styles;
 return <TemplateProvider pageNodeKey={pageNodeKey} styles={scoped} colors={colors} features={{inlineItemHeader:inline}}><Section section={section} placement="main"/></TemplateProvider>;
};

const useJpAcademicCnTemplate = (): JpAcademicCnTemplate => {
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
 sectionGroup:{},
header:{rowGap:9,borderBottomWidth:1.5,borderBottomColor:foreground,paddingBottom:9,marginBottom:6},headerTitle:{flex:1},headerName:{fontSize:18,lineHeight:1.2},picture:{width:48,height:48,objectFit:"cover",flexShrink:0},contactList:{flexDirection:"row",flexWrap:"wrap",justifyContent:hasTemplatePicture(picture)?"flex-start":"center",columnGap:9,rowGap:3,fontSize:9},contactItem:{flexDirection:"row",columnGap:3},sectionHeadingContainer:{marginBottom:4.5},sectionHeading:{fontSize:10,borderBottomWidth:.75,borderBottomColor:"#d4d4d8",paddingBottom:2},inlineItemHeader:{flexDirection:"row",alignItems:"baseline",columnGap:4},inlineItemHeaderLeading:{fontWeight:700,flexShrink:1},inlineItemHeaderMiddle:{flexGrow:1,flexShrink:1},inlineItemHeaderTrailing:{fontSize:9,textAlign:"right",flexShrink:0},alignEnd:{textAlign:"right"},
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
			} satisfies JpAcademicCnStyles,
		};
	}, [picture, metadata, rtl]);
};
