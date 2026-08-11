import type { ApplicationCaseEventReadModel, CaseStage } from "@aijob/contracts";
import { getCaseStageLabel } from "./workspace-model";

export interface ApplicationCaseEventView {
  title: string;
  detail: string;
  legacyReadOnly: boolean;
}

export function canRecordManualApplication(stage: CaseStage): boolean {
  return stage === "interested" || stage === "preparing";
}

export function manualApplicationStatusCopy(stage: CaseStage): string {
  if (stage === "applied") return "这份求职项目已经由你确认完成投递。";
  if (stage === "interviewing") return "当前已经进入面试阶段，无需重新标记投递。";
  if (stage === "resolved") return "当前项目已经结束，不能回退并重新标记投递。";
  return "只有你确认在官方页面完成提交后，系统才会把阶段改为已投递。";
}

export function toApplicationCaseEventView(
  event: ApplicationCaseEventReadModel,
): ApplicationCaseEventView {
  if ("legacyReadOnly" in event) {
    return {
      title: "历史求职记录",
      detail: "该记录来自旧版事件格式，仅供查看。",
      legacyReadOnly: true,
    };
  }
  switch (event.eventType) {
    case "case_created":
      return {
        title: "创建求职项目",
        detail: `初始阶段：${getCaseStageLabel(event.eventData.initialStage)}。`,
        legacyReadOnly: false,
      };
    case "stage_transitioned":
      return {
        title: "更新求职阶段",
        detail: `${getCaseStageLabel(event.eventData.fromStage)} → ${getCaseStageLabel(event.eventData.toStage)}。`,
        legacyReadOnly: false,
      };
    case "outcome_corrected":
      return {
        title: "更正求职结果",
        detail: `${event.eventData.fromOutcome} → ${event.eventData.toOutcome}。`,
        legacyReadOnly: false,
      };
    case "job_version_upgraded":
      return {
        title: "确认岗位版本更新",
        detail: "固定岗位版本已由用户显式更新。",
        legacyReadOnly: false,
      };
    case "requirement_state_changed":
      return {
        title: "更新要求状态",
        detail: `要求状态更新为 ${event.eventData.toState}。`,
        legacyReadOnly: false,
      };
    case "requirement_evidence_changed": {
      const linkedCount =
        "action" in event.eventData
          ? event.eventData.action === "linked"
            ? event.eventData.evidenceIds.length
            : 0
          : event.eventData.linkedEvidenceIds.length;
      const removedCount =
        "action" in event.eventData
          ? event.eventData.action === "removed"
            ? event.eventData.evidenceIds.length
            : 0
          : event.eventData.removedEvidenceIds.length;
      return {
        title: "更新要求证据",
        detail: `新增 ${linkedCount} 条，移除 ${removedCount} 条证据关联。`,
        legacyReadOnly: false,
      };
    }
    case "question_added":
      return {
        title: "添加待确认问题",
        detail: "问题正文只在要求工作区显示。",
        legacyReadOnly: false,
      };
    case "question_updated":
      return {
        title: "更新待确认问题",
        detail: `问题状态更新为 ${event.eventData.toStatus}。`,
        legacyReadOnly: false,
      };
    case "official_link_opened":
      return {
        title: "打开岗位页面",
        detail: "打开链接不代表已经投递。",
        legacyReadOnly: false,
      };
    case "manual_application_recorded":
      return {
        title: "确认完成投递",
        detail: `${getCaseStageLabel(event.eventData.fromStage)} → 已投递；由用户手动确认。`,
        legacyReadOnly: false,
      };
    case "resume_document_derived":
      return {
        title: "创建岗位专属简历",
        detail: "岗位简历已固定当时的正文与证据修订。",
        legacyReadOnly: false,
      };
    case "interview_started":
      return {
        title: "开始文字面试",
        detail: event.eventData.mode === "template" ? "确定性模板模式。" : "受控 AI 模式。",
        legacyReadOnly: false,
      };
    case "debrief_confirmed":
      return {
        title: "确认面试复盘",
        detail: "复盘已确认，但不会自动改写经历或简历。",
        legacyReadOnly: false,
      };
  }
}
