import type { ResumeSemanticContent } from "@aijob/contracts";

export type ResumeEditorDirection = "up" | "down";

export function cloneResumeContent(content: ResumeSemanticContent): ResumeSemanticContent {
  return {
    ...content,
    sections: content.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => ({
        ...block,
        evidenceIds: [...block.evidenceIds],
      })),
    })),
  };
}

export function resumeContentEquals(
  left: ResumeSemanticContent,
  right: ResumeSemanticContent,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeBlockOrdinals(blocks: ResumeSemanticContent["sections"][number]["blocks"]) {
  return blocks.map((block, ordinal) => ({ ...block, ordinal }));
}

export function updateResumeSection(
  content: ResumeSemanticContent,
  sectionId: string,
  patch: Partial<Pick<ResumeSemanticContent["sections"][number], "title">>,
): ResumeSemanticContent {
  return {
    ...content,
    sections: content.sections.map((section) =>
      section.id === sectionId ? { ...section, ...patch } : section,
    ),
  };
}

export function addResumeSection(
  content: ResumeSemanticContent,
  input: { sectionId: string; blockId: string },
): ResumeSemanticContent {
  return {
    ...content,
    sections: [
      ...content.sections,
      {
        id: input.sectionId,
        ordinal: content.sections.length,
        title: "新章节",
        blocks: [
          {
            id: input.blockId,
            ordinal: 0,
            text: "",
            evidenceIds: [],
          },
        ],
      },
    ],
  };
}

export function removeResumeSection(
  content: ResumeSemanticContent,
  sectionId: string,
): ResumeSemanticContent {
  if (content.sections.length <= 1) return content;
  return {
    ...content,
    sections: content.sections
      .filter((section) => section.id !== sectionId)
      .map((section, ordinal) => ({ ...section, ordinal })),
  };
}

export function updateResumeBlock(
  content: ResumeSemanticContent,
  sectionId: string,
  blockId: string,
  patch: Partial<
    Pick<ResumeSemanticContent["sections"][number]["blocks"][number], "text" | "evidenceIds">
  >,
): ResumeSemanticContent {
  return {
    ...content,
    sections: content.sections.map((section) =>
      section.id === sectionId
        ? {
            ...section,
            blocks: section.blocks.map((block) =>
              block.id === blockId ? { ...block, ...patch } : block,
            ),
          }
        : section,
    ),
  };
}

export function addResumeBlock(
  content: ResumeSemanticContent,
  sectionId: string,
  blockId: string,
): ResumeSemanticContent {
  return {
    ...content,
    sections: content.sections.map((section) =>
      section.id === sectionId
        ? {
            ...section,
            blocks: [
              ...section.blocks,
              { id: blockId, ordinal: section.blocks.length, text: "", evidenceIds: [] },
            ],
          }
        : section,
    ),
  };
}

export function removeResumeBlock(
  content: ResumeSemanticContent,
  sectionId: string,
  blockId: string,
): ResumeSemanticContent {
  return {
    ...content,
    sections: content.sections.map((section) => {
      if (section.id !== sectionId || section.blocks.length <= 1) return section;
      return {
        ...section,
        blocks: normalizeBlockOrdinals(section.blocks.filter((block) => block.id !== blockId)),
      };
    }),
  };
}

export function moveResumeBlock(
  content: ResumeSemanticContent,
  sectionId: string,
  blockId: string,
  direction: ResumeEditorDirection,
): ResumeSemanticContent {
  return {
    ...content,
    sections: content.sections.map((section) => {
      if (section.id !== sectionId) return section;
      const blocks = [...section.blocks].sort(
        (left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id),
      );
      const from = blocks.findIndex((block) => block.id === blockId);
      const to = direction === "up" ? from - 1 : from + 1;
      if (from < 0 || to < 0 || to >= blocks.length) return section;
      [blocks[from], blocks[to]] = [
        blocks[to] as (typeof blocks)[number],
        blocks[from] as (typeof blocks)[number],
      ];
      return { ...section, blocks: normalizeBlockOrdinals(blocks) };
    }),
  };
}

export function toggleResumeBlockEvidence(
  content: ResumeSemanticContent,
  sectionId: string,
  blockId: string,
  evidenceId: string,
): ResumeSemanticContent {
  const block = content.sections
    .find((section) => section.id === sectionId)
    ?.blocks.find((item) => item.id === blockId);
  if (!block) return content;
  const evidenceIds = block.evidenceIds.includes(evidenceId)
    ? block.evidenceIds.filter((id) => id !== evidenceId)
    : [...block.evidenceIds, evidenceId];
  return updateResumeBlock(content, sectionId, blockId, { evidenceIds });
}

export function moveResumeSectionId(
  sectionOrder: string[],
  sectionId: string,
  direction: ResumeEditorDirection,
): string[] {
  const next = [...sectionOrder];
  const from = next.indexOf(sectionId);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= next.length) return sectionOrder;
  [next[from], next[to]] = [next[to] as string, next[from] as string];
  return next;
}

export function reconcileResumeSectionOrder(
  sectionOrder: string[],
  content: ResumeSemanticContent,
): string[] {
  const available = content.sections.map((section) => section.id);
  return [
    ...sectionOrder.filter((sectionId) => available.includes(sectionId)),
    ...available.filter((sectionId) => !sectionOrder.includes(sectionId)),
  ];
}

export function validateResumeDraft(content: ResumeSemanticContent): string[] {
  const errors: string[] = [];
  if (content.sections.length === 0) errors.push("至少保留一个章节。");
  for (const [sectionIndex, section] of content.sections.entries()) {
    if (!section.title.trim()) errors.push(`第 ${sectionIndex + 1} 个章节缺少标题。`);
    if (section.blocks.length === 0)
      errors.push(`${section.title || "未命名章节"} 至少保留一个区块。`);
    for (const [blockIndex, block] of section.blocks.entries()) {
      if (!block.text.trim()) {
        errors.push(`${section.title || "未命名章节"} 的第 ${blockIndex + 1} 个区块没有正文。`);
      }
    }
  }
  return errors;
}
