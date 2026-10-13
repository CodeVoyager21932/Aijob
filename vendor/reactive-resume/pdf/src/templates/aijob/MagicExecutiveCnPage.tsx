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

type MagicExecutiveCnStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	picture: Style;
	headerTitle: Style;
	headerName: Style;
	contactList: Style;
	contactItem: Style;
	sectionGroup: Style;
};

type MagicExecutiveCnTemplate = {
	colors: TemplateColorRoles;
	styles: MagicExecutiveCnStyles;
};

type MagicExecutiveCnHeaderProps = {
	styles: MagicExecutiveCnStyles;
};

export const MagicExecutiveCnPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = useMagicExecutiveCnTemplate();
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

const Header = ({styles}: MagicExecutiveCnHeaderProps) => {
 const {basics,picture}=useRender();return <SemanticHeaderView style={styles.header}>
 {hasTemplatePicture(picture) && <SemanticHeaderPicture src={picture.url} style={styles.picture}/>}
 <View style={styles.headerTitle}><Heading style={styles.headerName}>{basics.name}</Heading>
 {basics.headline && <Text>{basics.headline}</Text>}<SemanticContactListView style={styles.contactList}>
 <PhoneContactItem phone={basics.phone} style={styles.contactItem} />
 <EmailContactItem email={basics.email} style={styles.contactItem} />
 <LocationContactItem location={basics.location} style={styles.contactItem} />
 <WebsiteContactItem website={basics.website} style={styles.contactItem} />
 {basics.customFields.map(field=><CustomFieldContactItem key={field.id} field={field} style={styles.contactItem} />)}
 </SemanticContactListView></View>
 </SemanticHeaderView>;
};
const MagicSection = ({section,pageNodeKey,styles,colors}:{section:string;pageNodeKey:string;styles:MagicExecutiveCnStyles;colors:TemplateColorRoles})=>{
 const data=useRender(); const kind=data.customSections.find(item=>item.id===section)?.type ?? section;
 const timeline=["experience","education","projects"].includes(kind);
 return <TemplateProvider pageNodeKey={pageNodeKey} styles={styles} colors={colors} features={{sectionTimeline:timeline}}
 featureStyles={{sectionTimeline:{items:{position:"relative",rowGap:10},line:{position:"absolute",left:3,top:8,bottom:0,width:1.5,backgroundColor:"#dbe4f2"},item:{flexDirection:"row",columnGap:11},marker:{width:7,flexShrink:0,paddingTop:4},dot:{width:7,height:7,borderRadius:4,backgroundColor:colors.primary},content:{flex:1,rowGap:3}}}}>
 <Section section={section} placement="main" />
 </TemplateProvider>;
};

const useMagicExecutiveCnTemplate = (): MagicExecutiveCnTemplate => {
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
header:{flexDirection:"row",alignItems:"flex-start",columnGap:12,backgroundColor:"#eef4ff",padding:12,borderRadius:7.5,marginBottom:4.5},
 headerTitle:{flex:1,rowGap:4},headerName:{fontSize:10.5,lineHeight:1.2},
 picture:{width:30,height:30,borderRadius:15,objectFit:"cover",flexShrink:0},
 contactList:{flexDirection:"row",flexWrap:"wrap",columnGap:9,rowGap:3,fontSize:9},contactItem:{flexDirection:"row",columnGap:3},
 sectionHeadingContainer:{marginBottom:6},sectionHeading:{fontSize:12.75,borderBottomWidth:.7,borderBottomColor:primary,paddingBottom:4},
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
			} satisfies MagicExecutiveCnStyles,
		};
	}, [picture, metadata, rtl]);
};
