import { Link } from "react-router-dom";
import { PlannerPanel } from "../components/PlannerPanel";
export function PlannerWorkspacePage() {
  return (
    <section>
      <header className="career-page-heading">
        <div>
          <p className="core-eyebrow">把求职落实到每天</p>
          <h1>我的安排</h1>
        </div>
        <nav className="career-job-discovery__modes" aria-label="申请工作台">
          <Link to="/applications">申请进度</Link>
          <Link to="/applications/planner" className="is-active" aria-current="page">
            准备与日程
          </Link>
          <Link to="/today">今日概览</Link>
        </nav>
      </header>
      <PlannerPanel />
    </section>
  );
}
