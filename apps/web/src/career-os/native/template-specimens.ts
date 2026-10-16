import type { NativeTemplateId } from "@aijob/resume-core";

type TemplateSpecimen = { image: string; pdf: string; label: string; structure: string };

/** Every specimen is generated from the same server renderer used by personal drafts. */
export const templateSpecimens: Partial<Record<NativeTemplateId, TemplateSpecimen>> = {
  "studio-campus-cn": {
    image: "/native-templates/studio-campus-cn-v1.png?render=polish-v10-final",
    pdf: "/native-templates/studio-campus-cn-v1.pdf?render=polish-v10-final",
    label: "市场营销在校生 · 虚构内容与示例头像",
    structure: "曲线页首 · 单栏",
  },
  "studio-banner-cn": {
    image: "/native-templates/studio-banner-cn-v1.png?render=polish-v10-final",
    pdf: "/native-templates/studio-banner-cn-v1.pdf?render=polish-v10-final",
    label: "非技术岗位在校生 · 虚构内容与示例头像",
    structure: "横幅页首 · 通栏章节",
  },
  "studio-index-cn": {
    image: "/native-templates/studio-index-cn-v1.png?render=polish-v10-final",
    pdf: "/native-templates/studio-index-cn-v1.pdf?render=polish-v10-final",
    label: "非技术岗位在校生 · 虚构内容与示例头像",
    structure: "章节索引 · 宽正文",
  },
  "studio-sidebar-cn": {
    image: "/native-templates/studio-sidebar-cn-v1.png?render=field-layout-v11",
    pdf: "/native-templates/studio-sidebar-cn-v1.pdf?render=field-layout-v11",
    label: "非技术岗位在校生 · 虚构内容与示例头像",
    structure: "资料侧栏 · 经历主栏",
  },
  "studio-layered-cn": {
    image: "/native-templates/studio-layered-cn-v1.png?render=polish-v10-final",
    pdf: "/native-templates/studio-layered-cn-v1.pdf?render=polish-v10-final",
    label: "非技术岗位在校生 · 虚构内容与示例头像",
    structure: "跨接名片 · 连续正文",
  },
  "studio-cards-cn": {
    image: "/native-templates/studio-cards-cn-v1.png?render=polish-v10-final",
    pdf: "/native-templates/studio-cards-cn-v1.pdf?render=polish-v10-final",
    label: "非技术岗位在校生 · 虚构内容与示例头像",
    structure: "小页首 · 独立圆角卡片",
  },
};
