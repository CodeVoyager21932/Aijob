import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";

const compatibilityCopy = {
  recommendations: {
    eyebrow: "入口已合并",
    title: "从岗位或求职项目继续",
    copy: "旧推荐页不再生成新的独立推荐记录。你可以在岗位目录发现岗位，再把想认真准备的岗位加入自己的求职项目。",
  },
  insights: {
    eyebrow: "洞察回到具体岗位",
    title: "在求职项目中核对岗位要求",
    copy: "旧洞察页不再生成脱离岗位上下文的分析。进入具体求职项目后，可以逐条核对岗位原句、证据和待确认问题。",
  },
} as const;

export function LegacyCompatibilityPage({ surface }: { surface: keyof typeof compatibilityCopy }) {
  const config = compatibilityCopy[surface];
  return (
    <section className="career-placeholder-page" aria-labelledby="legacy-compatibility-heading">
      <span className="career-placeholder-page__icon">
        <Icon name={surface === "recommendations" ? "search" : "briefcase"} size={28} />
      </span>
      <p className="eyebrow">{config.eyebrow}</p>
      <h1 id="legacy-compatibility-heading">{config.title}</h1>
      <p>{config.copy}</p>
      <div className="career-placeholder-page__actions">
        <Link className="career-button career-button--primary" to="/jobs">
          发现岗位
          <Icon name="chevron" size={16} />
        </Link>
        <Link className="career-button career-button--quiet" to="/applications">
          打开我的求职
          <Icon name="chevron" size={16} />
        </Link>
      </div>
    </section>
  );
}
