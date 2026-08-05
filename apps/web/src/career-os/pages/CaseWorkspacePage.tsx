import type { ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { CaseHeader } from "../components/CaseHeader";
import { CaseTabs } from "../components/CaseTabs";
import { EvidenceState } from "../components/EvidenceState";
import { Icon } from "../components/Icon";
import { type CareerCase, type CaseTab, caseStages, getCareerCase, isCaseTab } from "../domain";

const phaseContent: Record<Exclude<CaseTab, "overview">, { title: string; copy: string }> = {
  requirements: {
    title: "JD能力静态工作区将在 Phase 1B 完成",
    copy: "当前路由已经固定岗位版本和 Case 上下文；下一切片才加入要求分组、原文引用和证据检查器。",
  },
  resume: {
    title: "定制简历静态工作区将在 Phase 1B 完成",
    copy: "当前不会加载完整编辑器或真实 AI；后续仍使用同一 Case、同一证据状态和同一右侧检查器。",
  },
  application: {
    title: "投递记录将在领域阶段接入",
    copy: "打开官方页面与手动确认已投递是两个独立事件，系统不会根据外链点击自动改变阶段。",
  },
  interview: {
    title: "文字面试将在 PoC 阶段接入",
    copy: "首轮只保存文字问题、回答、追问、证据引用和反馈，不处理语音、视频或录音。",
  },
  debrief: {
    title: "复盘将在一岗闭环中接入",
    copy: "只有用户确认后，复盘结果才可以形成新的经历表达修订；不会自动回写简历事实。",
  },
};

function CaseProgress({ careerCase }: { careerCase: CareerCase }) {
  const activeIndex = caseStages.findIndex((stage) => stage.value === careerCase.stage);
  return (
    <ol className="career-case-progress" aria-label="求职项目阶段">
      {caseStages.map((stage, index) => (
        <li
          key={stage.value}
          className={
            index === activeIndex ? "is-current" : index < activeIndex ? "is-complete" : undefined
          }
          aria-current={index === activeIndex ? "step" : undefined}
        >
          <span>{index <= activeIndex ? <Icon name="check" size={16} /> : index + 1}</span>
          {stage.label}
        </li>
      ))}
    </ol>
  );
}

function CaseOverview({ careerCase }: { careerCase: CareerCase }) {
  return (
    <div className="career-case-overview">
      <section className="career-case-overview__next">
        <div>
          <h2>下一步建议</h2>
          <strong>{careerCase.nextTask}</strong>
          <p>{careerCase.nextTaskDetail}</p>
        </div>
        <Link
          className="career-button career-button--primary"
          to={`/applications/${careerCase.id}/requirements`}
        >
          查看 JD 能力
          <Icon name="chevron" size={17} />
        </Link>
      </section>

      <section className="career-case-overview__axes" aria-labelledby="case-axes-heading">
        <header>
          <h2 id="case-axes-heading">三轴分别判断</h2>
          <p>不合并为匹配等级，也不自动劝退。</p>
        </header>
        <div>
          <article>
            <span>资格</span>
            <strong>{careerCase.qualification}</strong>
            <small>只依据岗位明确条件与已确认事实</small>
          </article>
          <article>
            <span>经历证据</span>
            <strong>{careerCase.evidence.length} 项逐项核对</strong>
            <small>每项证据状态独立保留</small>
          </article>
          <article>
            <span>偏好</span>
            <strong>{careerCase.preference}</strong>
            <small>只使用你主动设置的偏好</small>
          </article>
        </div>
      </section>

      <section className="career-case-overview__evidence" aria-labelledby="case-evidence-heading">
        <header>
          <h2 id="case-evidence-heading">当前经历证据</h2>
          <Link to={`/applications/${careerCase.id}/requirements`}>进入 JD 能力页</Link>
        </header>
        <ul>
          {careerCase.evidence.map((item) => (
            <li key={item.id}>
              <span>{item.label}</span>
              <EvidenceState state={item.state} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function PhasePlaceholder({ tab }: { tab: Exclude<CaseTab, "overview"> }) {
  const content = phaseContent[tab];
  return (
    <section className="career-case-phase-placeholder">
      <span>
        <Icon
          name={tab === "resume" ? "document" : tab === "interview" ? "interview" : "briefcase"}
        />
      </span>
      <div>
        <p>Phase 1A 路由骨架</p>
        <h2>{content.title}</h2>
        <p>{content.copy}</p>
      </div>
    </section>
  );
}

function renderCaseTab(tab: CaseTab, careerCase: CareerCase): ReactNode {
  return tab === "overview" ? (
    <CaseOverview careerCase={careerCase} />
  ) : (
    <PhasePlaceholder tab={tab} />
  );
}

export function CaseWorkspacePage() {
  const { caseId, tab } = useParams();
  const careerCase = getCareerCase(caseId);

  if (!careerCase) {
    return (
      <section className="career-not-found">
        <h1>没有找到这个静态求职项目</h1>
        <Link to="/applications">返回我的求职</Link>
      </section>
    );
  }

  if (!isCaseTab(tab)) {
    return <Navigate to={`/applications/${careerCase.id}/overview`} replace />;
  }

  return (
    <section className="career-case-workspace">
      <CaseHeader careerCase={careerCase} />
      <CaseTabs caseId={careerCase.id} />
      <CaseProgress careerCase={careerCase} />
      <div className="career-case-version-note" role="note">
        <Icon name="check" size={17} />
        当前静态工作区固定岗位版本 2026/08/04；后续新版本只展示差异，不会静默替换。
      </div>
      {renderCaseTab(tab, careerCase)}
    </section>
  );
}
