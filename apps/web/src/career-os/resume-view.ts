import type {
  ResumeDocumentContentRevisionReadModel,
  ResumeDocumentLayoutRevisionReadModel,
} from "@aijob/contracts";

export interface ResumeBlockView {
  id: string;
  text: string;
  evidenceIds: string[];
  ordinal: number;
}

export interface ResumeSectionView {
  id: string;
  title: string;
  ordinal: number;
  blocks: ResumeBlockView[];
}

export function orderResumeSections(
  contentRevision: ResumeDocumentContentRevisionReadModel,
  layoutRevision: ResumeDocumentLayoutRevisionReadModel | null,
): ResumeSectionView[] {
  const layoutOrder = new Map(
    (layoutRevision?.sectionOrder ?? []).map((sectionId, index) => [sectionId, index]),
  );
  return contentRevision.content.sections
    .map((section) => ({
      id: section.id,
      title: section.title,
      ordinal: section.ordinal,
      blocks: [...section.blocks]
        .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
        .map((block) => ({
          id: block.id,
          text: block.text,
          evidenceIds: "evidenceIds" in block ? block.evidenceIds : [],
          ordinal: block.ordinal,
        })),
    }))
    .sort((left, right) => {
      const leftLayout = layoutOrder.get(left.id);
      const rightLayout = layoutOrder.get(right.id);
      if (leftLayout !== undefined && rightLayout !== undefined) return leftLayout - rightLayout;
      if (leftLayout !== undefined) return -1;
      if (rightLayout !== undefined) return 1;
      return left.ordinal - right.ordinal || left.id.localeCompare(right.id);
    });
}

export function findResumeBlock(
  sections: ResumeSectionView[],
  requestedBlockId: string | null,
): { selected: ResumeBlockView | null; requestedBlockExists: boolean } {
  const blocks = sections.flatMap((section) => section.blocks);
  const requested = requestedBlockId
    ? blocks.find((block) => block.id === requestedBlockId)
    : undefined;
  return {
    selected: requested ?? blocks[0] ?? null,
    requestedBlockExists: requestedBlockId === null || requested !== undefined,
  };
}
