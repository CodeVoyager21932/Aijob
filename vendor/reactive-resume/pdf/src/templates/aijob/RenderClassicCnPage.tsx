// Native adaptation: rendercv; MIT. Fixed source and adaptation notes in source.json and catalog-provenance.mts.
// Fixed source config/components: vendor/resume-template-references/rendercv/source.json.
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

type RenderClassicCnStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	picture: Style;
	headerTitle: Style;
	headerName: Style;
	contactList: Style;
	contactItem: Style;
	sectionGroup: Style;
};

type RenderClassicCnTemplate = {
	colors: TemplateColorRoles;
	styles: RenderClassicCnStyles;
};

type RenderClassicCnHeaderProps = {
	styles: RenderClassicCnStyles;
};

export const RenderClassicCnPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = useRenderClassicCnTemplate();
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

const Header=({styles}:RenderClassicCnHeaderProps)=>{ const {basics,picture}=useRender(); const contactText={color:"#004f90",fontSize:10}; return <SemanticHeaderView style={styles.header}><View style={{flex:1,rowGap:12,textAlign:"center"}}><Heading style={styles.headerName}>{basics.name}</Heading>{basics.headline&&<Text style={{fontSize:10,color:"#004f90"}}>{basics.headline}</Text>}<SemanticContactListView style={styles.contactList}><PhoneContactItem phone={basics.phone} style={styles.contactItem} textStyle={contactText}/><EmailContactItem email={basics.email} style={styles.contactItem} textStyle={contactText}/><LocationContactItem location={basics.location} style={styles.contactItem} textStyle={contactText}/><WebsiteContactItem website={basics.website} style={styles.contactItem} textStyle={contactText}/>{basics.customFields.map(field=><CustomFieldContactItem key={field.id} field={field} style={styles.contactItem} textStyle={contactText}/>)}</SemanticContactListView></View>{hasTemplatePicture(picture)&&<SemanticHeaderPicture src={picture.url} style={styles.picture}/>}</SemanticHeaderView>; };
const TemplateSection=({section,pageNodeKey,styles,colors}:{section:string;pageNodeKey:string;styles:RenderClassicCnStyles;colors:TemplateColorRoles})=>{const data=useRender();const kind=data.customSections.find(item=>item.id===section)?.type??section; const scoped=kind==="education" ? {...styles,inlineItemHeaderLeading:{width:70,fontWeight:700,flexShrink:0},inlineItemHeaderMiddle:{flex:1,fontWeight:700},inlineItemHeaderTrailing:{width:112,fontSize:9,textAlign:"right"}} : styles;return <TemplateProvider pageNodeKey={pageNodeKey} styles={scoped} colors={colors} features={{inlineItemHeader:["education","experience"].includes(kind)}} renderSectionHeading={({title})=><View style={{flexDirection:"row",alignItems:"center",columnGap:9,marginBottom:8.5}}><Heading style={{fontSize:14,color:colors.primary}}>{title}</Heading><View style={{flex:1,height:.5,backgroundColor:colors.primary}}/></View>}><Section section={section} placement="main"/></TemplateProvider>;};
const useRenderClassicCnTemplate = (): RenderClassicCnTemplate => {
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
 sectionGroup:{},headerTitle:{flex:1},contactList:{flexDirection:"row",flexWrap:"wrap",justifyContent:"center",columnGap:9,rowGap:3},contactItem:{flexDirection:"row",columnGap:3},inlineItemHeader:{flexDirection:"row",alignItems:"baseline",columnGap:6},inlineItemHeaderLeading:{fontWeight:700,flexShrink:1},inlineItemHeaderMiddle:{flex:1},inlineItemHeaderTrailing:{fontSize:9,textAlign:"right",flexShrink:0},alignEnd:{textAlign:"right"},header:{flexDirection:"row",alignItems:"center",columnGap:14,paddingBottom:12},headerName:{fontSize:30,lineHeight:1.2,color:primary},picture:{width:70,height:85,objectFit:"cover",flexShrink:0},
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
			} satisfies RenderClassicCnStyles,
		};
	}, [picture, metadata, rtl]);
};
