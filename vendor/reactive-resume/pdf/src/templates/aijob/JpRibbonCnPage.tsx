// Native adaptation: jobpilot; Apache-2.0. Fixed source and adaptation notes in source.json and catalog-provenance.mts.
// Fixed source config/components: vendor/resume-template-references/jobpilot/source.json.
import type { Style } from "@react-pdf/types";
import type { TemplatePageProps } from "../../document";
import type { TemplateColorRoles, TemplateStyleContext, TemplateStyleSlots } from "../shared/types";
import { useMemo } from "react";
import { rgbaStringToHex } from "@reactive-resume/utils/color";
import { Page, StyleSheet, View, Svg, Polygon } from "#react-pdf-renderer";
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

type JpRibbonCnStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	picture: Style;
	headerTitle: Style;
	headerName: Style;
	contactList: Style;
	contactItem: Style;
	sectionGroup: Style;
};

type JpRibbonCnTemplate = {
	colors: TemplateColorRoles;
	styles: JpRibbonCnStyles;
};

type JpRibbonCnHeaderProps = {
	styles: JpRibbonCnStyles;
};

export const JpRibbonCnPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = useJpRibbonCnTemplate();
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

const Header=({styles}:JpRibbonCnHeaderProps)=>{ const {basics,picture}=useRender(); const contactText={color:"#ffffff",fontSize:9}; return <SemanticHeaderView style={styles.header}><Svg style={{position:"absolute",left:0,bottom:-8}} width={15} height={9}><Polygon points="0,0 15,0 15,9" fill="#991b1b"/></Svg><Svg style={{position:"absolute",right:0,bottom:-8}} width={15} height={9}><Polygon points="0,0 15,0 0,9" fill="#991b1b"/></Svg><View style={{flex:1,rowGap:4,textAlign:"left"}}><Heading style={styles.headerName}>{basics.name}</Heading>{basics.headline&&<Text style={{fontSize:13.5,color:"#ffffff"}}>{basics.headline}</Text>}<SemanticContactListView style={styles.contactList}><PhoneContactItem phone={basics.phone} style={styles.contactItem} textStyle={contactText}/><EmailContactItem email={basics.email} style={styles.contactItem} textStyle={contactText}/><LocationContactItem location={basics.location} style={styles.contactItem} textStyle={contactText}/><WebsiteContactItem website={basics.website} style={styles.contactItem} textStyle={contactText}/>{basics.customFields.map(field=><CustomFieldContactItem key={field.id} field={field} style={styles.contactItem} textStyle={contactText}/>)}</SemanticContactListView></View>{hasTemplatePicture(picture)&&<SemanticHeaderPicture src={picture.url} style={styles.picture}/>}</SemanticHeaderView>; };
const TemplateSection=({section,pageNodeKey,styles,colors}:{section:string;pageNodeKey:string;styles:JpRibbonCnStyles;colors:TemplateColorRoles})=>{const data=useRender();const kind=data.customSections.find(item=>item.id===section)?.type??section; const scoped=kind==="experience" ? {...styles,item:{rowGap:3,borderLeftWidth:1.5,borderLeftColor:colors.primary,paddingLeft:9}} : styles;return <TemplateProvider pageNodeKey={pageNodeKey} styles={scoped} colors={colors} features={{inlineItemHeader:["education","experience"].includes(kind)}} renderSectionHeading={({title})=><View style={{flexDirection:"row",alignItems:"center",marginBottom:9}}><View style={{backgroundColor:colors.primary,paddingVertical:3,paddingHorizontal:12}}><Heading style={{fontSize:10,color:"#fff"}}>{title}</Heading></View><Svg width={6} height={20}><Polygon points="0,0 6,10 0,20" fill={colors.primary}/></Svg><View style={{flex:1,height:.75,marginLeft:6,backgroundColor:"#e5e7eb"}}/></View>}><Section section={section} placement="main"/></TemplateProvider>;};
const useJpRibbonCnTemplate = (): JpRibbonCnTemplate => {
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
 sectionGroup:{},headerTitle:{flex:1},contactList:{flexDirection:"row",flexWrap:"wrap",justifyContent:"flex-start",columnGap:9,rowGap:3},contactItem:{flexDirection:"row",columnGap:3},inlineItemHeader:{flexDirection:"row",alignItems:"baseline",columnGap:6},inlineItemHeaderLeading:{fontWeight:700,flexShrink:1},inlineItemHeaderMiddle:{flex:1},inlineItemHeaderTrailing:{fontSize:9,textAlign:"right",flexShrink:0},alignEnd:{textAlign:"right"},header:{position:"relative",flexDirection:"row",alignItems:"center",columnGap:15,backgroundColor:primary,marginHorizontal:-24,marginTop:-24,padding:24,marginBottom:14},headerName:{fontSize:18,lineHeight:1.2,color:"#fff"},picture:{width:60,height:60,objectFit:"cover",borderWidth:2,borderColor:"#fca5a5",flexShrink:0},
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
			} satisfies JpRibbonCnStyles,
		};
	}, [picture, metadata, rtl]);
};
