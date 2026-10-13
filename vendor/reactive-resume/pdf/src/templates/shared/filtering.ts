import type { CustomSectionType, Summary } from "@reactive-resume/schema/resume/data";

type HiddenItem = {
	hidden: boolean;
	[key: string]: unknown;
};

type TitleBackedSectionType = Exclude<CustomSectionType, "summary" | "cover-letter">;

type ItemSectionLike<T extends HiddenItem = HiddenItem> = {
	hidden: boolean;
	items: T[];
};

type CustomSectionLike = ItemSectionLike & {
	id: string;
	type?: string;
};

type FilterableData = {
	summary: Pick<Summary, "hidden" | "content">;
	sections: Partial<Record<string, ItemSectionLike>>;
	customSections: CustomSectionLike[];
};

const primaryTitleFields = {
	profiles: "network",
	experience: "company",
	education: "school",
	projects: "name",
	skills: "name",
	languages: "language",
	interests: "name",
	awards: "title",
	certifications: "title",
	publications: "title",
	volunteer: "organization",
	references: "name",
} satisfies Record<TitleBackedSectionType, string>;

const isItemSection = (section: unknown): section is ItemSectionLike => {
	return typeof section === "object" && section !== null && "items" in section;
};

const isSummarySection = (section: unknown): section is Summary => {
	return typeof section === "object" && section !== null && "content" in section;
};

const hasText = (value: unknown): value is string => {
	return typeof value === "string" && value.trim().length > 0;
};

const getPrimaryTitleField = (sectionType?: string): string | undefined => {
	return primaryTitleFields[sectionType as TitleBackedSectionType];
};

// Aijob drafts may be unfinished. Visibility follows real content, not a mandatory title.
const contentFields = new Set(["role","unit","method","authors","authorPosition","status","name","company","school","title","organization","network","language","position","location","period","degree","area","grade","publisher","date","issuer","awarder","proficiency","fluency","username","phone","description","content","recipient","keywords","url","label"]);
const hasVisibleContent = (value: unknown, key = ""): boolean => {
  if(typeof value === "string" && contentFields.has(key)) return value.replace(/<[^>]*>/g, "").replace(/&(?:nbsp|#160);/gi," ").trim().length > 0;
  if(Array.isArray(value)) return value.some(item=>hasVisibleContent(item,key));
  if(value && typeof value === "object") return Object.entries(value).some(([field,item])=>hasVisibleContent(item,field));
  return false;
};
const hasValidPrimaryTitle = (item: HiddenItem, sectionType?: string): boolean => {
  const titleField=getPrimaryTitleField(sectionType);
  return (titleField && hasText(item[titleField])) || hasVisibleContent(item);
};
const hasVisibleExperienceRole = (role: unknown): boolean => hasVisibleContent(role);

const filterExperienceRoles = <T extends HiddenItem>(item: T, sectionType?: string): T => {
	if (sectionType !== "experience") return item;

	const roles = (item as { roles?: unknown }).roles;

	if (!Array.isArray(roles)) return item;

	const visibleRoles = roles.filter(hasVisibleExperienceRole);

	if (visibleRoles.length === roles.length) return item;

	return { ...item, roles: visibleRoles } as T;
};

export const filterItems = <T extends HiddenItem>(items: T[], sectionType?: string): T[] => {
	const visibleItems: T[] = [];

	for (const item of items) {
		if (item.hidden || !hasValidPrimaryTitle(item, sectionType)) continue;
		visibleItems.push(filterExperienceRoles(item, sectionType));
	}

	return visibleItems;
};

export const hasVisibleItems = (section: ItemSectionLike, sectionType?: string): boolean => {
	return !section.hidden && filterItems(section.items, sectionType).length > 0;
};

export const isVisibleSummary = (summary: Pick<Summary, "hidden" | "content">): boolean => {
	return !summary.hidden && summary.content.trim().length > 0;
};

const getSectionForFiltering = (sectionId: string, data: FilterableData) => {
	if (sectionId === "summary") return data.summary;

	return data.sections[sectionId] ?? data.customSections.find((section) => section.id === sectionId);
};

const getSectionTypeForFiltering = (sectionId: string, section: unknown): string | undefined => {
	if (sectionId === "summary") return "summary";

	if (typeof section === "object" && section !== null && "type" in section) {
		const type = (section as { type?: unknown }).type;

		if (typeof type === "string") return type;
	}

	return sectionId;
};

export const isSectionVisible = (sectionId: string, data: FilterableData): boolean => {
	const section = getSectionForFiltering(sectionId, data);
	const sectionType = getSectionTypeForFiltering(sectionId, section);

	if (!section) return false;
	if (isSummarySection(section)) return isVisibleSummary(section);
	if (isItemSection(section)) return hasVisibleItems(section, sectionType);

	return false;
};

export const filterSections = (sectionIds: string[], data: FilterableData): string[] => {
	return sectionIds.filter((sectionId) => isSectionVisible(sectionId, data));
};
