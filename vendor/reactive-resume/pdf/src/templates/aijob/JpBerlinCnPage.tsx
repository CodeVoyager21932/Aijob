// Native adaptation of jlifeng/JobPilot 69e6692 (Apache-2.0); native primitives MIT.
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

type JpBerlinCnStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	picture: Style;
	headerTitle: Style;
	headerName: Style;
	contactList: Style;
	contactItem: Style;
	sectionGroup: Style;
};

type JpBerlinCnTemplate = {
	colors: TemplateColorRoles;
	styles: JpBerlinCnStyles;
};

type JpBerlinCnHeaderProps = {
	styles: JpBerlinCnStyles;
};

export const JpBerlinCnPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = useJpBerlinCnTemplate();
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

const Header=({styles}:JpBerlinCnHeaderProps)=>{const {basics,picture}=useRender();return <SemanticHeaderView style={styles.header}>
  <View style={{position:"absolute",right:24,top:12,width:60,height:60,borderRadius:30,borderWidth:3,borderColor:"#eab308",opacity:.6}}/>
  <View style={{position:"absolute",right:72,bottom:9,width:24,height:24,backgroundColor:"#dc2626",opacity:.7}}/>
  <View style={{position:"absolute",right:18,bottom:18,width:9,height:36,backgroundColor:"#2563eb",opacity:.7}}/>
  <View style={{flexDirection:"row",columnGap:18,alignItems:"center",paddingRight:72}}>
  {hasTemplatePicture(picture)&&<SemanticHeaderPicture src={picture.url} style={styles.picture}/>}
  <View style={{flex:1,rowGap:3}}><Heading style={styles.headerName}>{basics.name}</Heading>{basics.headline&&<Text style={{fontSize:10.5,color:"#eab308"}}>{basics.headline}</Text>}<SemanticContactListView style={styles.contactList}>
 <PhoneContactItem phone={basics.phone} style={styles.contactItem} textStyle={{color:"#e5e7eb",fontSize:9}}/><EmailContactItem email={basics.email} style={styles.contactItem} textStyle={{color:"#e5e7eb",fontSize:9}}/>
 <LocationContactItem location={basics.location} style={styles.contactItem} textStyle={{color:"#e5e7eb",fontSize:9}}/><WebsiteContactItem website={basics.website} style={styles.contactItem} textStyle={{color:"#e5e7eb",fontSize:9}}/>
 {basics.customFields.map(field=><CustomFieldContactItem key={field.id} field={field} style={styles.contactItem} textStyle={{color:"#e5e7eb",fontSize:9}}/>)}
 </SemanticContactListView></View></View></SemanticHeaderView>;};
const TemplateSection=({section,pageNodeKey,styles,colors}:{section:string;pageNodeKey:string;styles:JpBerlinCnStyles;colors:TemplateColorRoles})=>{
 const data=useRender();const kind=data.customSections.find(item=>item.id===section)?.type??section;
 const order=[...new Set(data.metadata.layout.pages.flatMap(p=>filterSections([...p.main,...p.sidebar],data)))];const ordinal=order.indexOf(section)+1;
 const scoped=kind==="summary"?{...styles,summary:{borderLeftWidth:3,borderLeftColor:colors.primary,paddingLeft:12}}:styles;
 return <TemplateProvider pageNodeKey={pageNodeKey} styles={scoped} colors={colors} features={{inlineItemHeader:["education","experience"].includes(kind)}} renderSectionHeading={({title})=><View style={{flexDirection:"row",alignItems:"center",columnGap:6,marginBottom:9}}><View style={{width:15,height:15,borderRadius:7.5,backgroundColor:"#2563eb"}}/><Heading style={{fontSize:10.5,flex:1}}>{title}</Heading><View style={{width:36,height:3,backgroundColor:"#eab308"}}/></View>}><Section section={section} placement="main"/></TemplateProvider>;
};

const useJpBerlinCnTemplate = (): JpBerlinCnTemplate => {
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
header:{position:"relative",backgroundColor:"#000000",color:"#ffffff",paddingHorizontal:30,paddingVertical:24,marginHorizontal:-24,marginTop:-24,marginBottom:18},headerTitle:{},headerName:{fontSize:22.5,lineHeight:1.2,color:"#ffffff"},picture:{width:60,height:60,objectFit:"cover",borderWidth:3,borderColor:"#eab308",flexShrink:0},contactList:{flexDirection:"row",flexWrap:"wrap",columnGap:12,rowGap:3,fontSize:9,color:"#e5e7eb",marginTop:6},contactItem:{flexDirection:"row",columnGap:3,color:"#e5e7eb"},inlineItemHeader:{flexDirection:"row",alignItems:"baseline",columnGap:6},inlineItemHeaderLeading:{fontWeight:700,flexShrink:1},inlineItemHeaderMiddle:{flexGrow:1,flexShrink:1},inlineItemHeaderTrailing:{fontSize:9,textAlign:"right",flexShrink:0},alignEnd:{textAlign:"right"},
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
			} satisfies JpBerlinCnStyles,
		};
	}, [picture, metadata, rtl]);
};
