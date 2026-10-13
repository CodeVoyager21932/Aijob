// Native adaptation of Magic-Resume/Magic-Resume c7e0826 (MIT).
// Fixed source config/components: vendor/resume-template-references/magic-resume/source.json.
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

type MagicProductCnStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	picture: Style;
	headerTitle: Style;
	headerName: Style;
	contactList: Style;
	contactItem: Style;
	sectionGroup: Style;
};

type MagicProductCnTemplate = {
	colors: TemplateColorRoles;
	styles: MagicProductCnStyles;
};

type MagicProductCnHeaderProps = {
	styles: MagicProductCnStyles;
};

export const MagicProductCnPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = useMagicProductCnTemplate();
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
						<MagicSection key={section} section={section} pageNodeKey={pageNodeKey} styles={styles} colors={colors} />
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

const Header=({styles}:MagicProductCnHeaderProps)=>{
 const {basics,picture}=useRender();return <SemanticHeaderView style={styles.header}>
 <View style={styles.headerTitle}><Heading style={styles.headerName}>{basics.name}</Heading>
 {basics.headline&&<Text>{basics.headline}</Text>}
 <SemanticContactListView style={styles.contactList}>
 {basics.phone&&<View style={styles.contactItem}><Text>电话：</Text><PhoneContactItem phone={basics.phone}/></View>}
 {basics.email&&<View style={styles.contactItem}><Text>邮箱：</Text><EmailContactItem email={basics.email}/></View>}
 {basics.location&&<View style={styles.contactItem}><Text>城市：</Text><LocationContactItem location={basics.location}/></View>}
 {basics.website.url&&<View style={styles.contactItem}><Text>主页：</Text><WebsiteContactItem website={basics.website}/></View>}
 {basics.customFields.map(field=><CustomFieldContactItem key={field.id} field={field} style={styles.contactItem}/>)}
 </SemanticContactListView></View>
 {hasTemplatePicture(picture)&&<SemanticHeaderPicture src={picture.url} style={styles.picture}/>}
 </SemanticHeaderView>;
};

const MagicSection=({section,pageNodeKey,styles,colors}:{section:string;pageNodeKey:string;styles:MagicProductCnStyles;colors:TemplateColorRoles})=>{
 const data=useRender();const kind=data.customSections.find(item=>item.id===section)?.type??section;
 const inline=["education","experience"].includes(kind);
 return <TemplateProvider pageNodeKey={pageNodeKey} styles={styles} colors={colors}
 features={{inlineItemHeader:inline,organizationFirst:inline,}}>
 <Section section={section} placement="main"/>
 </TemplateProvider>;
};

const useMagicProductCnTemplate = (): MagicProductCnTemplate => {
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
header:{flexDirection:"row",columnGap:12,alignItems:"flex-start",marginBottom:7.5},headerTitle:{flex:1,rowGap:4},headerName:{fontSize:15,lineHeight:1.2},picture:{width:57,height:72,objectFit:"cover",flexShrink:0},contactList:{flexDirection:"row",flexWrap:"wrap",columnGap:12,rowGap:3,fontSize:9},contactItem:{flexDirection:"row",width:"46%",flexWrap:"wrap",columnGap:2,fontSize:9},sectionHeadingContainer:{marginBottom:5},sectionHeading:{fontSize:12,borderBottomWidth:.75,borderBottomColor:primary,paddingBottom:5,color:primary},inlineItemHeader:{flexDirection:"column",position:"relative",paddingRight:120,rowGap:3},inlineItemHeaderMiddle:{fontWeight:700},inlineItemHeaderLeading:{fontSize:metadata.typography.body.fontSize},inlineItemHeaderTrailing:{position:"absolute",right:0,top:0,fontSize:metadata.typography.body.fontSize},alignEnd:{textAlign:"right"},
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
			} satisfies MagicProductCnStyles,
		};
	}, [picture, metadata, rtl]);
};
