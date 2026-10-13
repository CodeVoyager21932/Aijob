// Aijob Chinese adaptation of jlifeng/JobPilot Engineer at 69e6692 (Apache-2.0).
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

type EngineerCnStyles = Omit<TemplateStyleSlots, "page"> & {
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

type EngineerCnTemplate = {
	colors: TemplateColorRoles;
	styles: EngineerCnStyles;
};

type EngineerCnHeaderProps = {
	styles: EngineerCnStyles;
};

export const EngineerCnPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = useEngineerCnTemplate();
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

				<SemanticRegionView region="main" style={composeStyles(styles.sectionGroup, { rowGap: metrics.sectionGap })}>
					{mainSections.map((section) => (
						<Section key={section} section={section} placement="main" />
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

const Header = ({ styles }: EngineerCnHeaderProps) => {
 const { basics, picture } = useRender();
 return <SemanticHeaderView style={styles.header}>
  <View style={{ flexDirection: "row", columnGap: 14, alignItems: "center" }}>
   {hasTemplatePicture(picture) && <SemanticHeaderPicture src={picture.url} style={styles.picture} />}
   <View style={{ flex: 1, rowGap: 5 }}>
    <Heading style={styles.headerName}>{basics.name}</Heading>
    {basics.headline && <Text style={{ color: "#7dd3fc", fontSize: 11 }}>{basics.headline}</Text>}
   </View>
   <SemanticContactListView style={styles.contactList}>
    <EmailContactItem email={basics.email} style={styles.contactItem} textStyle={{color: "#e2e8f0", fontSize: 9}} />
    <PhoneContactItem phone={basics.phone} style={styles.contactItem} textStyle={{color: "#e2e8f0", fontSize: 9}} />
    <LocationContactItem location={basics.location} style={styles.contactItem} textStyle={{color: "#e2e8f0", fontSize: 9}} />
    <WebsiteContactItem website={basics.website} style={styles.contactItem} textStyle={{color: "#e2e8f0", fontSize: 9}} />
    {basics.customFields.map(field => <CustomFieldContactItem key={field.id} field={field} style={styles.contactItem} textStyle={{color: "#e2e8f0", fontSize: 9}} />)}
   </SemanticContactListView>
  </View>
  <View style={{flexDirection:"row",alignItems:"center",columnGap:4,marginTop:14}}>
   <View style={{height:1.5,flex:1,backgroundColor:"#0284c7"}} />
   <View style={{width:1,height:6,backgroundColor:"#0284c7"}} />
   <View style={{width:24,height:1.5,backgroundColor:"#0284c7"}} />
   <View style={{width:1,height:6,backgroundColor:"#0284c7"}} />
   <View style={{height:1.5,flex:1,backgroundColor:"#0284c7"}} />
  </View>
 </SemanticHeaderView>;
};

const useEngineerCnTemplate = (): EngineerCnTemplate => {
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
                backgroundColor: "#1e293b",
                padding: 20,
                marginHorizontal: -metrics.page.paddingHorizontal,
                marginTop: -metrics.page.paddingVertical,
                marginBottom: 10,
            },
            picture: { ...base.picture, width: 48, height: 48, borderWidth: 1.5, borderColor: "#0284c7" },
            headerTitle: { flex: 1 },
            headerIdentity: { alignItems: "flex-start" },
            headerName: { fontSize: 20, color: "#ffffff", lineHeight: headerNameLineHeight },
            contactList: { maxWidth: "42%", flexDirection: "column", rowGap: 3, fontSize: 9, alignItems: "flex-end", color: "#e2e8f0" },
            contactItem: { flexDirection: "row", color: "#e2e8f0", fontSize: 9, textAlign: "right", columnGap: 3 },
			sectionGroup: {},
            sectionHeading: { borderBottomWidth: 1, borderBottomColor: primary, paddingBottom: 5, marginBottom: 4, fontSize: 12, color: "#1e293b" },
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
			} satisfies EngineerCnStyles,
		};
	}, [picture, metadata, rtl]);
};
