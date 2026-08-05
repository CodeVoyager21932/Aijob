import { Link } from "react-router-dom";
import { Icon, type IconName } from "../components/Icon";

const surfaceConfig = {
  resumes: {
    title: "简历资产",
    copy: "基础简历、模板与岗位派生版本将在后续阶段进入同一资产视图。",
    icon: "document",
  },
  interviews: {
    title: "面试训练",
    copy: "跨岗位文字练习历史将在文字面试 PoC 通过后接入。",
    icon: "interview",
  },
  knowledge: {
    title: "经验库",
    copy: "这里只保存 URL、短摘要、适用场景和你的笔记，不抓取文章全文。",
    icon: "book",
  },
} as const satisfies Record<string, { title: string; copy: string; icon: IconName }>;

export function CareerOsPlaceholderPage({ surface }: { surface: keyof typeof surfaceConfig }) {
  const config = surfaceConfig[surface];
  return (
    <section className="career-placeholder-page">
      <span className="career-placeholder-page__icon">
        <Icon name={config.icon} size={28} />
      </span>
      <h1>{config.title}</h1>
      <p>{config.copy}</p>
      <div className="career-phase-label">Phase 1A 路由骨架</div>
      <Link className="career-button career-button--quiet" to="/applications">
        返回我的求职
        <Icon name="chevron" size={16} />
      </Link>
    </section>
  );
}
