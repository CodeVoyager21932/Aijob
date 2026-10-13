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

type JpBlocksCnStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	picture: Style;
	headerTitle: Style;
	headerName: Style;
	contactList: Style;
	contactItem: Style;
	sectionGroup: Style;
};

type JpBlocksCnTemplate = {
	colors: TemplateColorRoles;
	styles: JpBlocksCnStyles;
};

type JpBlocksCnHeaderProps = {
	styles: JpBlocksCnStyles;
};

export const JpBlocksCnPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = useJpBlocksCnTemplate();
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

const Header=({styles}:JpBlocksCnHeaderProps)=>{const {basics,picture}=useRender();return <SemanticHeaderView style={styles.header}>
  <View style={{flexDirection:"row",columnGap:12,alignItems:"center"}}>{hasTemplatePicture(picture)&&<SemanticHeaderPicture src={picture.url} style={styles.picture}/>}
  <View style={{flex:1,rowGap:2}}><Heading style={styles.headerName}>{basics.name}</Heading>{basics.headline&&<Text style={{fontSize:10.5,color:"#787774"}}>{basics.headline}</Text>}</View></View><SemanticContactListView style={styles.contactList}>
 <PhoneContactItem phone={basics.phone} style={styles.contactItem}/><EmailContactItem email={basics.email} style={styles.contactItem}/>
 <LocationContactItem location={basics.location} style={styles.contactItem}/><WebsiteContactItem website={basics.website} style={styles.contactItem}/>
 {basics.customFields.map(field=><CustomFieldContactItem key={field.id} field={field} style={styles.contactItem}/>)}
 </SemanticContactListView></SemanticHeaderView>;};
const TemplateSection=({section,pageNodeKey,styles,colors}:{section:string;pageNodeKey:string;styles:JpBlocksCnStyles;colors:TemplateColorRoles})=>{
 const data=useRender();const kind=data.customSections.find(item=>item.id===section)?.type??section;
 const order=[...new Set(data.metadata.layout.pages.flatMap(p=>filterSections([...p.main,...p.sidebar],data)))];const ordinal=order.indexOf(section)+1;
 const scoped=kind==="summary"?{...styles,summary:{backgroundColor:"#f7f6f3",padding:9,borderRadius:3}}:styles;
 return <TemplateProvider pageNodeKey={pageNodeKey} styles={scoped} colors={colors} features={{inlineItemHeader:["education","experience"].includes(kind)}} renderSectionHeading={({title})=><View style={{flexDirection:"row",alignItems:"center",columnGap:6,marginLeft:-15,marginBottom:6}}><Svg width={8} height={8} viewBox="0 0 8 8"><Polygon points="0,0 8,4 0,8" fill="#9b9a97"/></Svg><Heading style={{fontSize:10.5}}>{title}</Heading></View>}><Section section={section} placement="main"/></TemplateProvider>;
};

const useJpBlocksCnTemplate = (): JpBlocksCnTemplate => {
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
				rowGap: 6,
                paddingLeft:15,
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
header:{rowGap:9,borderBottomWidth:.75,borderBottomColor:"#e3e2de",paddingBottom:12,marginBottom:12},headerTitle:{},headerName:{fontSize:18,lineHeight:1.2},picture:{width:42,height:42,objectFit:"cover",flexShrink:0},contactList:{flexDirection:"row",flexWrap:"wrap",columnGap:6,rowGap:6,fontSize:9,color:"#787774"},contactItem:{flexDirection:"row",columnGap:3,backgroundColor:"#f7f6f3",paddingHorizontal:6,paddingVertical:1.5,borderRadius:1.5},inlineItemHeader:{flexDirection:"row",alignItems:"baseline",columnGap:6},inlineItemHeaderLeading:{fontWeight:700,flexShrink:1},inlineItemHeaderMiddle:{flexGrow:1,flexShrink:1},inlineItemHeaderTrailing:{fontSize:9,textAlign:"right",flexShrink:0},alignEnd:{textAlign:"right"},
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
			} satisfies JpBlocksCnStyles,
		};
	}, [picture, metadata, rtl]);
};
