import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { filterSections } from "./filtering";

/** Header summaries must not pull content out of a later page or reorder a new draft. */
export function shouldPlaceSummaryInHeader(
  data: ResumeData,
  page: { main: readonly string[] },
  showHeader: boolean,
) {
  if (!showHeader || !filterSections(["summary"], data).includes("summary")) return false;
  if (!data.metadata.page.respectSectionPlacement) return true;
  return filterSections([...page.main], data)[0] === "summary" && !data.summary.startOnNewPage;
}
