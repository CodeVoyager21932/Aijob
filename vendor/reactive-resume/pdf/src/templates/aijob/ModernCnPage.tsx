// Aijob Chinese adaptation of jlifeng/JobPilot Modern at 69e6692 (Apache-2.0).
// Native page/section primitives are from Reactive Resume 86a72bef (MIT).
// See vendor/resume-template-references/jobpilot/source.json for unchanged references.
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

type ModernCnStyles = Omit<TemplateStyleSlots, "page"> & {
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

type ModernCnTemplate = {
	colors: TemplateColorRoles;
	styles: ModernCnStyles;
};

type ModernCnHeaderProps = {
	styles: ModernCnStyles;
};

export const ModernCnPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = useModernCnTemplate();
	const metrics = getTemplateMetrics(metadata.page);
	const mainSections = useRenderedSectionIds(pageNodeKey, filterSections(page.main, data));
	const sidebarSections = useRenderedSectionIds(pageNodeKey, filterSections(page.sidebar, data));

	return (
		<Page
			{...semanticPageProps}
			size={semanticPageSize ?? pageSize}
			style={composeStyles(styles.page, pageMinHeightStyle, semanticPageStyle)}
		>
			<TemplateProvider pageNodeKey={pageNodeKey} styles={styles} colors={colors} features={{ sectionHeadingLeadingRule: true }}>
				{showHeader && <Header styles={styles} />}

				<SemanticRegionView region="main" style={composeStyles(styles.sectionGroup, { rowGap: metrics.sectionGap })}>
					{mainSections.map((section) => (
						<ModernSection key={section} section={section} pageNodeKey={pageNodeKey} styles={styles} colors={colors} />
					))}
				</SemanticRegionView>

				{!page.fullWidth && (
					<SemanticRegionView
						region="sidebar"
						style={composeStyles(styles.sectionGroup, { rowGap: metrics.sectionGap })}
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

const ModernSection = ({ section, pageNodeKey, styles, colors }: {
 section:string; pageNodeKey:string; styles:ModernCnStyles; colors:TemplateColorRoles;
}) => {
 const data=useRender();
 const kind=data.customSections.find(item=>item.id===section)?.type ?? section;
 const scoped=kind === "experience" ? {...styles,inlineItemHeader:{flexDirection:"column",rowGap:3,position:"relative",paddingRight:110},inlineItemHeaderLeading:{fontWeight:700},inlineItemHeaderMiddle:{color:colors.primary},inlineItemHeaderTrailing:{position:"absolute",right:0,top:0},item:{rowGap:2,borderLeftWidth:1.5,borderLeftColor:colors.primary,paddingLeft:12},alignEnd:{fontSize:9,backgroundColor:"#f4f4f5",paddingHorizontal:5,paddingVertical:2,borderRadius:6}} : styles;
 return <TemplateProvider pageNodeKey={pageNodeKey} styles={scoped} colors={colors} features={{sectionHeadingLeadingRule:true,inlineItemHeader:kind === "experience"}}>
  <Section section={section} placement="main" />
 </TemplateProvider>;
};

const Header = ({ styles }: ModernCnHeaderProps) => {
 const { basics, picture } = useRender();
 return <SemanticHeaderView style={styles.header}>
  {hasTemplatePicture(picture) && <SemanticHeaderPicture src={picture.url} style={styles.picture} />}
  <View style={{flex:1,rowGap:5}}>
   <Heading style={styles.headerName}>{basics.name}</Heading>
   {basics.headline && <Text style={{color:"#fda4af",fontSize:11}}>{basics.headline}</Text>}
   <SemanticContactListView style={styles.contactList}>
    <EmailContactItem email={basics.email} style={styles.contactItem} textStyle={{color:"#e2e8f0",fontSize:9}} />
    <PhoneContactItem phone={basics.phone} style={styles.contactItem} textStyle={{color:"#e2e8f0",fontSize:9}} />
    <LocationContactItem location={basics.location} style={styles.contactItem} textStyle={{color:"#e2e8f0",fontSize:9}} />
    <WebsiteContactItem website={basics.website} style={styles.contactItem} textStyle={{color:"#e2e8f0",fontSize:9}} />
    {basics.customFields.map(field=><CustomFieldContactItem key={field.id} field={field} style={styles.contactItem} textStyle={{color:"#e2e8f0",fontSize:9}} />)}
   </SemanticContactListView>
  </View>
 </SemanticHeaderView>;
};

const useModernCnTemplate = (): ModernCnTemplate => {
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
				rowGap: metrics.sectionGap,
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
                backgroundColor: "#16213e",
                flexDirection: "row", alignItems: "center", columnGap: 18, borderBottomWidth: 2.25, borderBottomColor: primary,
                padding: 24,
                marginHorizontal: -metrics.page.paddingHorizontal,
                marginTop: -metrics.page.paddingVertical,
                marginBottom: 10,
            },
            picture: { ...base.picture, width: 60, height: 60, borderWidth: 1.5, borderColor: "#e94560" },
            headerTitle: { flex: 1 },
            headerIdentity: { alignItems: "flex-start" },
            headerName: { fontSize: 22.5, color: "#ffffff", lineHeight: headerNameLineHeight },
            contactList: { flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 4, fontSize: 9, color: "#e2e8f0" },
            contactItem: { flexDirection: "row", color: "#e2e8f0", fontSize: 9, textAlign: "left", columnGap: 3 },
			sectionGroup: {},
            sectionHeading: { fontSize: 11, color: primary },
            sectionHeadingContainer: { flexDirection:"row",alignItems:"center",columnGap:8,marginBottom:8 },
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
			} satisfies ModernCnStyles,
		};
	}, [picture, metadata, rtl]);
};
