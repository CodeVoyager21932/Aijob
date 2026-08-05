import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { StageBadge } from "../components/StageBadge";
import { careerCases } from "../domain";

const todaysCases = careerCases.filter((careerCase) => careerCase.stage !== "resolved").slice(0, 4);

export function CareerOsHomePage() {
  return (
    <section className="career-home-page" aria-labelledby="today-title">
      <header className="career-page-heading career-page-heading--today">
        <div>
          <h1 id="today-title">今日</h1>
          <p>2026 年 8 月 4 日</p>
        </div>
        <Link className="career-button career-button--primary" to="/applications">
          查看我的求职
          <Icon name="chevron" size={17} />
        </Link>
      </header>

      <div className="career-today-layout">
        <section className="career-today-tasks" aria-labelledby="today-tasks-heading">
          <header>
            <h2 id="today-tasks-heading">接下来要做</h2>
            <span>{todaysCases.length} 项</span>
          </header>
          <ol>
            {todaysCases.map((careerCase) => (
              <li key={careerCase.id}>
                <Link to={`/applications/${careerCase.id}/overview`}>
                  <span className="career-today-task__icon">
                    <Icon name="briefcase" />
                  </span>
                  <span>
                    <strong>{careerCase.nextTask}</strong>
                    <small>
                      {careerCase.companyName} · {careerCase.roleTitle}
                    </small>
                  </span>
                  <StageBadge stage={careerCase.stage} />
                  <Icon name="chevron" size={17} />
                </Link>
              </li>
            ))}
          </ol>
        </section>

        <aside className="career-today-note">
          <Icon name="check" />
          <h2>每一步都由你确认</h2>
          <p>打开官方页面不会自动标记为已投递；未说明的信息继续保持未知。</p>
          <Link to="/settings/data">查看数据保留与删除</Link>
        </aside>
      </div>
    </section>
  );
}
