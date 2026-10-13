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

type MagicCompactCnStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	header: Style;
	picture: Style;
	headerTitle: Style;
	headerName: Style;
	contactList: Style;
	contactItem: Style;
	sectionGroup: Style;
};

type MagicCompactCnTemplate = {
	colors: TemplateColorRoles;
	styles: MagicCompactCnStyles;
};

type MagicCompactCnHeaderProps = {
	styles: MagicCompactCnStyles;
};

export const MagicCompactCnPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = useMagicCompactCnTemplate();
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

const Header = ({styles}: MagicCompactCnHeaderProps) => {
 const {basics,picture}=useRender(); const photo=hasTemplatePicture(picture);
 return <SemanticHeaderView style={styles.header}>
  {photo && <View style={{width:64.5,flexShrink:0}} />}
  <View style={styles.headerTitle}><Heading style={styles.headerName}>{basics.name}</Heading><SemanticContactListView style={styles.contactList}>
 <PhoneContactItem phone={basics.phone} style={styles.contactItem} />
 <EmailContactItem email={basics.email} style={styles.contactItem} />
 <LocationContactItem location={basics.location} style={styles.contactItem} />
 <WebsiteContactItem website={basics.website} style={styles.contactItem} />
 {basics.customFields.map(field=><CustomFieldContactItem key={field.id} field={field} style={styles.contactItem} />)}
 </SemanticContactListView>
   {basics.headline && <Text>{basics.headline}</Text>}
  </View>
  {photo && <SemanticHeaderPicture src={picture.url} style={styles.picture} />}
 </SemanticHeaderView>;
};
const MagicSection = ({section,pageNodeKey,styles,colors}:{section:string;pageNodeKey:string;styles:MagicCompactCnStyles;colors:TemplateColorRoles})=>{
 const data=useRender(); const kind=data.customSections.find(item=>item.id===section)?.type ?? section;
 const grid=["experience","education"].includes(kind);
 return <TemplateProvider pageNodeKey={pageNodeKey} styles={styles} colors={colors} features={{inlineItemHeader:grid,organizationFirst:grid}}>
  <Section section={section} placement="main" />
 </TemplateProvider>;
};

const useMagicCompactCnTemplate = (): MagicCompactCnTemplate => {
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
header:{flexDirection:"row",alignItems:"flex-start",columnGap:9,marginBottom:6},
 headerTitle:{flex:1,alignItems:"center",textAlign:"center",rowGap:5},
 headerName:{fontSize:22,lineHeight:1.2}, picture:{width:64.5,height:89.25,objectFit:"cover",flexShrink:0},
 contactList:{flexDirection:"row",flexWrap:"wrap",justifyContent:"center",columnGap:8,rowGap:3,fontSize:10},
 contactItem:{flexDirection:"row",columnGap:3},
 sectionHeadingContainer:{marginBottom:4},
 sectionHeading:{fontSize:13.5,color:foreground,borderBottomWidth:.5,borderBottomColor:foreground,paddingBottom:3},
 inlineItemHeader:{flexDirection:"row",alignItems:"baseline",columnGap:9},
 inlineItemHeaderMiddle:{flex:1.65,fontWeight:700},
 inlineItemHeaderLeading:{flex:.85,textAlign:"center",fontWeight:700},
 inlineItemHeaderTrailing:{flex:1.15,textAlign:"right",fontWeight:700},
 alignEnd:{textAlign:"right"},
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
			} satisfies MagicCompactCnStyles,
		};
	}, [picture, metadata, rtl]);
};
