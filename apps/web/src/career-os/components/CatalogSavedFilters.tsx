import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { saveCatalogSearch } from "../../api/bookmarks";
import {
  getDiscoveryStatus,
  opportunityKeys,
  updateOpportunitySubscription,
} from "../../api/opportunities";
import type { JobFilters } from "../../api/product";
import { coreKeys, getSavedSearches, removeSavedSearch } from "../../api/product-core";
import { jobFamilyLabels } from "../../product/domain";
import { jobFiltersFromSearchParams, recommendationRequestFromFilters } from "../job-navigation";
import { Icon } from "./Icon";
import { ModalSurface } from "./ModalSurface";
import "./automatic-opportunities.css";

const dateLabel = (value: string | null | undefined, empty: string) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : empty;
const split = (value: string) =>
  value
    .split(/[，,、；;\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
function toFilters(query: Record<string, unknown>) {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) p.set(key, Array.isArray(value) ? value.join(",") : String(value));
  return jobFiltersFromSearchParams(p);
}
export function CatalogSavedFilters({
  filters,
  onApply,
}: {
  filters: JobFilters;
  onApply: (filters: JobFilters) => void;
}) {
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState<{ id: string; revision: number } | null>(null);
  const [direction, setDirection] = useState(filters),
    [cityText, setCityText] = useState(filters.cities.join("、")),
    [label, setLabel] = useState(""),
    [time, setTime] = useState("09:00"),
    [subscribe, setSubscribe] = useState(true);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const client = useQueryClient();
  const query = useQuery({ queryKey: coreKeys.searches, queryFn: () => getSavedSearches() });
  const status = useQuery({
    queryKey: opportunityKeys.status,
    queryFn: getDiscoveryStatus,
    refetchInterval: 30000,
  });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: coreKeys.searches }),
      client.invalidateQueries({ queryKey: opportunityKeys.digests }),
      client.invalidateQueries({ queryKey: opportunityKeys.status }),
    ]);
  };
  const remove = useMutation({ mutationFn: removeSavedSearch, onSuccess: refresh });
  const save = useMutation({
    mutationFn: () =>
      editing
        ? updateOpportunitySubscription(editing.id, {
            expectedRevision: editing.revision,
            label,
            catalogQuery: {
              ...recommendationRequestFromFilters(direction).scope,
              sort: direction.sort ?? "verified_desc",
            },
            discoveryEnabled: subscribe,
            digestEnabled: subscribe,
            digestTime: time,
            timezone: "Asia/Shanghai",
          })
        : saveCatalogSearch(label, direction, undefined, {
            discoveryEnabled: subscribe,
            digestEnabled: subscribe,
            digestTime: time,
            timezone: "Asia/Shanghai",
          }),
    onSuccess: async () => {
      setOpen(false);
      setEditing(null);
      onApply(direction);
      setNotice(
        subscribe
          ? "方向已保存。先整理当前机会；新搜索会在服务配置并开启后执行。"
          : "筛选已保存，尚未启用每日更新。",
      );
      await refresh();
    },
    onError: (e) => setError(e.message),
  });
  const toggle = useMutation({
    mutationFn: ({
      id,
      revision,
      enabled,
      digestTime,
    }: {
      id: string;
      revision: number;
      enabled: boolean;
      digestTime: string;
    }) =>
      updateOpportunitySubscription(id, {
        expectedRevision: revision,
        discoveryEnabled: enabled,
        digestEnabled: enabled,
        digestTime,
        timezone: "Asia/Shanghai",
      }),
    onSuccess: refresh,
  });
  const data = status.data;
  const searches = query.data?.items.filter((item) => item.catalogQuery) ?? [];
  const graphSearches = query.data?.items.filter((item) => !item.catalogQuery) ?? [];
  const activeCount = searches.filter(
    (item) => item.subscription.digestEnabled || item.subscription.discoveryEnabled,
  ).length;
  const searchState = !data
    ? "读取中"
    : data.provider === "existing_sources"
      ? "仅已有官网"
      : data.capability && data.capability !== "ready"
        ? data.capability === "queued"
          ? "检查中"
          : "需处理"
        : !data.configured
          ? "待配置"
          : !data.enabled
            ? "已暂停"
            : /^(DISCOVERY_|SEARCH_|AI_)/.test(data.lastSearchStatus ?? "")
              ? "需处理"
              : data.lastSearchAt
                ? "已开启"
                : "等待首次搜索";
  const sourceState = !data
    ? "读取中"
    : !data.sourceRefresh
      ? "由维护者管理"
      : data.sourceRefresh.enabled && data.sourceRefresh.networkEnabled
        ? "已开启"
        : "已暂停";
  function begin() {
    setEditing(null);
    setDirection({ ...filters });
    setCityText(filters.cities.join("、"));
    setLabel("");
    setTime("09:00");
    setSubscribe(true);
    setError("");
    setOpen(true);
  }
  function edit(item: (typeof searches)[number]) {
    const savedFilters = toFilters(item.catalogQuery ?? {});
    setDirection(savedFilters);
    setCityText(savedFilters.cities.join("、"));
    setEditing({ id: item.id, revision: item.revision });
    setLabel(item.label);
    setTime(item.subscription.digestTime);
    setSubscribe(item.subscription.digestEnabled || item.subscription.discoveryEnabled);
    setError("");
    setOpen(true);
  }
  return (
    <section
      className="automatic-opportunities"
      id="automatic-opportunities"
      aria-labelledby="auto-opportunities-title"
    >
      <div className="automatic-opportunities__intro">
        <div>
          <p className="automatic-opportunities__eyebrow">
            <Icon name="search" size={16} /> 持续发现 · 每日整理
          </p>
          <h2 id="auto-opportunities-title">自动找岗位</h2>
          <p>告诉系统你想找什么，新的机会和重要变化会汇总到「今日」。</p>
        </div>
        <div className="automatic-opportunities__actions">
          <button className="career-button career-button--primary" type="button" onClick={begin}>
            ＋ 设置求职方向
          </button>
          <Link to="/today">查看机会摘要 →</Link>
          <Link to="/settings/ai">连接与运行</Link>
        </div>
      </div>
      <section className="automatic-opportunities__status" aria-label="自动找岗位运行状态">
        <div>
          <span>我的方向</span>
          <strong>
            {activeCount
              ? `${activeCount} 个正在订阅`
              : searches.length
                ? "订阅已暂停"
                : "尚未设置"}
          </strong>
          <small>
            {searches.length ? `共保存 ${searches.length} 个方向` : "支持方向、城市和岗位关键词"}
          </small>
        </div>
        <div>
          <span>发现新招聘入口</span>
          <strong
            data-state={
              searchState === "待配置" || searchState === "需处理" ? "attention" : undefined
            }
          >
            {searchState}
          </strong>
          <small>
            {data?.lastSearchStatus === "DISCOVERY_AUTH_REQUIRED"
              ? "Key 验证失败，请更新配置"
              : data?.lastSearchStatus === "DISCOVERY_RATE_LIMITED"
                ? "搜索服务暂时限流，稍后自动重试"
                : /^(DISCOVERY_|SEARCH_|AI_)/.test(data?.lastSearchStatus ?? "")
                  ? "上次搜索未完成，请检查设置或稍后重试"
                  : data?.configured && data.enabled
                    ? `今日 ${data.dailyUsed}/${data.dailyLimit} 次 · 本月 ${data.monthlyUsed}/${data.monthlyLimit} 次`
                    : data?.provider === "existing_sources"
                      ? "不使用外部搜索，不消耗搜索用量"
                      : "可以复用支持搜索的 AI，或选择独立搜索"}
          </small>
        </div>
        <div>
          <span>已接入官网刷新</span>
          <strong>{sourceState}</strong>
          <small>按来源周期核对新增与变化</small>
        </div>
      </section>
      {data && (
        <div className="automatic-opportunities__setup">
          <p>
            {!data.configured
              ? "可以先使用已有官网；需要扩展新网站时，再选择搜索连接。"
              : !data.enabled ||
                  (data.sourceRefresh &&
                    (!data.sourceRefresh.enabled || !data.sourceRefresh.networkEnabled))
                ? "部分自动更新已暂停，可在设置中启用。"
                : "已按设置启用。电脑运行期间处理，首次成功前不计为已验证。"}
          </p>
          <Link className="career-button" to="/settings/ai">
            选择搜索方式与查看状态 →
          </Link>
        </div>
      )}
      <div className="automatic-opportunities__timing">
        <span>最近搜索：{dateLabel(data?.lastSearchAt, "尚未运行")}</span>
        <span>
          下次搜索：
          {data?.nextSearchAt && new Date(data.nextSearchAt) <= new Date()
            ? "等待后台处理"
            : dateLabel(
                data?.nextSearchAt,
                data?.configured && data.enabled ? "保存方向后安排" : "启用后安排",
              )}
        </span>
        <span>最近摘要：{dateLabel(data?.lastDigestAt, "尚未生成")}</span>
        {data?.nextDigestAt && (
          <span>
            下次摘要：
            {new Date(data.nextDigestAt) <= new Date()
              ? "正在等待整理"
              : dateLabel(data.nextDigestAt, "")}
          </span>
        )}
      </div>
      {notice && <output className="automatic-opportunities__notice">{notice}</output>}
      {searches.length > 0 && (
        <div className="automatic-opportunities__directions">
          <h3>我的求职方向</h3>
          {searches.map((item) => (
            <article key={item.id}>
              <div>
                <strong>{item.label}</strong>
                <small>
                  {item.subscription.digestEnabled
                    ? `每天 ${item.subscription.digestTime} 汇总 · 北京时间`
                    : "已暂停每日更新"}
                </small>
              </div>
              <div className="automatic-opportunities__row-actions">
                <button type="button" onClick={() => onApply(toFilters(item.catalogQuery ?? {}))}>
                  查看岗位
                </button>
                <button type="button" onClick={() => edit(item)}>
                  编辑方向
                </button>
                <button
                  type="button"
                  disabled={toggle.isPending}
                  onClick={() =>
                    toggle.mutate({
                      id: item.id,
                      revision: item.revision,
                      enabled: !item.subscription.digestEnabled,
                      digestTime: item.subscription.digestTime,
                    })
                  }
                >
                  {item.subscription.digestEnabled ? "暂停" : "启用"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {graphSearches.length > 0 && (
        <details className="automatic-opportunities__legacy">
          <summary>已保存的方向图谱（{graphSearches.length}）</summary>
          {graphSearches.map((item) => (
            <Link
              key={item.id}
              to={`/jobs/insights?scope=${encodeURIComponent(JSON.stringify(item.scope))}${item.dataset === "private" ? "&dataset=private" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </details>
      )}
      {(status.isError || query.isError || toggle.isError || remove.isError) && (
        <p role="alert">
          自动找岗位状态读取或更新失败。
          <button className="career-button" type="button" onClick={() => void refresh()}>
            重新读取
          </button>
        </p>
      )}
      {open && (
        <ModalSurface
          className="automatic-direction-dialog"
          ariaLabel={editing ? "编辑求职方向" : "设置求职方向"}
          onClose={() => setOpen(false)}
          closeLabel="关闭方向设置"
        >
          <header>
            <div>
              <span>自动找岗位</span>
              <h2>{editing ? "调整你的求职方向" : "你想找怎样的机会？"}</h2>
            </div>
            <button type="button" className="career-button" onClick={() => setOpen(false)}>
              关闭
            </button>
          </header>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError("");
              save.mutate();
            }}
          >
            <label>
              方向名称
              <input
                value={label}
                required
                maxLength={120}
                placeholder="例如：上海数据分析实习"
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <div className="automatic-direction-dialog__pair">
              <label>
                岗位方向
                <select
                  value={direction.jobFamilies[0] ?? ""}
                  onChange={(e) =>
                    setDirection((v) => ({
                      ...v,
                      jobFamilies: e.target.value ? [e.target.value] : [],
                    }))
                  }
                >
                  <option value="">不限方向</option>
                  {Object.entries(jobFamilyLabels).map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                期望城市
                <input
                  value={cityText}
                  placeholder="例如：上海、杭州"
                  onChange={(e) => {
                    setCityText(e.target.value);
                    setDirection((v) => ({ ...v, cities: split(e.target.value) }));
                  }}
                />
              </label>
            </div>
            <label>
              岗位关键词
              <input
                value={direction.keyword}
                maxLength={200}
                placeholder="例如：数据分析、暑期实习、校招"
                onChange={(e) => setDirection((v) => ({ ...v, keyword: e.target.value }))}
              />
            </label>
            <p className="automatic-direction-dialog__note">
              其他筛选沿用当前岗位目录，未说明的条件继续保留。
            </p>
            <label className="automatic-direction-dialog__check">
              <input
                type="checkbox"
                checked={subscribe}
                onChange={(e) => setSubscribe(e.target.checked)}
              />
              自动寻找新企业，并每天汇总岗位变化
            </label>
            {subscribe && (
              <label>
                每日汇总时间（北京时间）
                <input
                  type="time"
                  required
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </label>
            )}
            {subscribe && (!data?.configured || !data.enabled) && (
              <p className="automatic-direction-dialog__note">
                可先保存方向并整理当前机会。扩展新招聘入口时，在「连接与运行」选择搜索方式。
              </p>
            )}
            {error && <p role="alert">{error}</p>}
            <footer>
              {editing && (
                <button
                  className="career-button"
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(editing.id, { onSuccess: () => setOpen(false) })}
                >
                  删除方向
                </button>
              )}
              <button
                className="career-button career-button--primary"
                type="submit"
                disabled={save.isPending}
              >
                {save.isPending
                  ? "保存中…"
                  : editing
                    ? "保存方向修改"
                    : subscribe
                      ? "保存并订阅"
                      : "仅保存筛选"}
              </button>
            </footer>
          </form>
        </ModalSurface>
      )}
    </section>
  );
}
