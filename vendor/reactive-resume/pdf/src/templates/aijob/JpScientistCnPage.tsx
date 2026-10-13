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

type JpScientistCnStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	picture: Style;
	headerTitle: Style;
	headerName: Style;
	contactList: Style;
	contactItem: Style;
	sectionGroup: Style;
};

type JpScientistCnTemplate = {
	colors: TemplateColorRoles;
	styles: JpScientistCnStyles;
};

type JpScientistCnHeaderProps = {
	styles: JpScientistCnStyles;
};

export const JpScientistCnPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = useJpScientistCnTemplate();
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

const Header=({styles}:JpScientistCnHeaderProps)=>{const {basics,picture}=useRender();return <SemanticHeaderView style={styles.header}>
  {hasTemplatePicture(picture)&&<SemanticHeaderPicture src={picture.url} style={styles.picture}/>}
  <Heading style={styles.headerName}>{basics.name}</Heading>{basics.headline&&<Text style={{fontSize:10.5,color:"#0891b2"}}>{basics.headline}</Text>}<SemanticContactListView style={styles.contactList}>
 <PhoneContactItem phone={basics.phone} style={styles.contactItem}/><EmailContactItem email={basics.email} style={styles.contactItem}/>
 <LocationContactItem location={basics.location} style={styles.contactItem}/><WebsiteContactItem website={basics.website} style={styles.contactItem}/>
 {basics.customFields.map(field=><CustomFieldContactItem key={field.id} field={field} style={styles.contactItem}/>)}
 </SemanticContactListView></SemanticHeaderView>;};
const TemplateSection=({section,pageNodeKey,styles,colors}:{section:string;pageNodeKey:string;styles:JpScientistCnStyles;colors:TemplateColorRoles})=>{
 const data=useRender();const kind=data.customSections.find(item=>item.id===section)?.type??section;
 const order=[...new Set(data.metadata.layout.pages.flatMap(p=>filterSections([...p.main,...p.sidebar],data)))];const ordinal=order.indexOf(section)+1;
 const scoped=styles;
 return <TemplateProvider pageNodeKey={pageNodeKey} styles={scoped} colors={colors} features={{inlineItemHeader:["education","experience"].includes(kind)}} renderSectionHeading={({title})=><View style={{rowGap:5,marginBottom:6}}><View style={{flexDirection:"row",alignItems:"baseline",columnGap:6}}><Text style={{fontWeight:700,color:colors.primary}}>{ordinal}.</Text><Heading style={{fontSize:10.5}}>{title}</Heading></View><View style={{borderBottomWidth:.75,borderBottomColor:"#e2e8f0"}}/></View>}><Section section={section} placement="main"/></TemplateProvider>;
};

const useJpScientistCnTemplate = (): JpScientistCnTemplate => {
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
header:{alignItems:"center",rowGap:6,borderBottomWidth:.75,borderBottomColor:foreground,paddingBottom:18,marginBottom:12},headerTitle:{},headerName:{fontSize:18,textAlign:"center",lineHeight:1.2},picture:{width:42,height:42,objectFit:"cover",borderWidth:1.5,borderColor:primary},contactList:{flexDirection:"row",flexWrap:"wrap",justifyContent:"center",columnGap:9,rowGap:3,fontSize:9,color:"#64748b"},contactItem:{flexDirection:"row",columnGap:3},inlineItemHeader:{flexDirection:"row",alignItems:"baseline",columnGap:6},inlineItemHeaderLeading:{fontWeight:700,flexShrink:1},inlineItemHeaderMiddle:{flexGrow:1,flexShrink:1},inlineItemHeaderTrailing:{fontSize:9,textAlign:"right",flexShrink:0},alignEnd:{textAlign:"right"},
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
			} satisfies JpScientistCnStyles,
		};
	}, [picture, metadata, rtl]);
};
