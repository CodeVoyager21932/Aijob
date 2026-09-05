import type { ApplicationHandoff, JobDetail } from "@aijob/contracts";
import { Icon } from "./Icon";

export function ApplicationHandoffLink({
  handoff,
  methods = [],
}: {
  handoff: ApplicationHandoff;
  methods?: JobDetail["applicationMethods"];
}) {
  return (
    <div className="career-application-link" data-handoff-kind={handoff.kind}>
      {handoff.kind === "missing" ? (
        <p role="note">当前没有已核验的官方岗位链接，请核验投递入口。</p>
      ) : (
        <>
          <a
            className="career-button career-button--quiet"
            href={handoff.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {handoff.kind === "exact" ? "打开官方投递页面" : "前往官方列表查找岗位"}
            <Icon name="external" size={16} />
          </a>
          {handoff.kind === "official_list_fallback" ? (
            <p>
              官方仅提供岗位列表，请按「{handoff.locator.title}」或编号「
              {handoff.locator.sourceJobId}」查找并核对。
            </p>
          ) : null}
        </>
      )}
      {methods.map((method) =>
        method.type === "company_email" ? (
          <p key={method.email}>
            企业招聘邮箱：<a href={`mailto:${method.email}`}>{method.email}</a>
          </p>
        ) : null,
      )}
    </div>
  );
}
