import type { DiscoverySettingsInput, SearchAdapter } from "@aijob/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { subscribeToSessionBoundary } from "../../api/client";
import {
  checkDiscoverySettings,
  getDiscoverySettings,
  putDiscoverySettings,
  removeDiscoverySettings,
} from "../../api/discovery-settings";
import "./discovery-settings.css";

const modes = [
  {
    value: "existing_sources",
    title: "只刷新已接入网站",
    detail: "不需要 Key。持续整理已启用官网的岗位与变化。",
  },
  {
    value: "ai_connection",
    title: "复用我的 AI 连接",
    detail: "检查当前接口是否能联网搜索；支持时，无需第二份 Key。",
  },
  {
    value: "tavily",
    title: "使用独立搜索",
    detail: "用 Tavily 发现新的招聘入口，写作仍使用自己的 AI。",
  },
] as const;
const statusText: Record<string, string> = {
  unchecked: "保存后检查搜索能力",
  queued: "正在执行一次简短搜索…",
  ready: "搜索已就绪",
  unsupported: "当前接口或模型不支持这种搜索方式",
  unrecognized: "未取得可验证的搜索来源",
  temporary_failure: "搜索检查暂未完成",
};
const errorText: Record<string, string> = {
  SEARCH_AUTH_REQUIRED: "请检查 Key 的有效性与该接口的使用权限。",
  SEARCH_RATE_LIMITED: "服务商暂时限流，请稍后重试。",
  SEARCH_METHOD_UNSUPPORTED: "这不影响已有的 AI 写作功能。可以换支持搜索的模型，或选择独立搜索。",
  SEARCH_TOOL_NOT_OBSERVED: "接口没有返回搜索执行记录，不能据此认定它具备联网搜索能力。",
  SEARCH_SOURCES_MISSING: "接口没有返回可追溯来源，目前不能用于发现新网站。",
  SEARCH_NETWORK_FAILED: "网络连接未完成，可以稍后重试。",
  SEARCH_BUDGET_EXHAUSTED: "已达到搜索用量限制，已接网站仍会继续刷新。",
  AI_BUDGET_EXHAUSTED: "已达到 AI 用量限制，可在下方高级设置调整。",
  SEARCH_REQUEST_FAILED: "本次请求没有完成，可重试检查。",
};
export function DiscoverySettingsCard({ aiConfigured }: { aiConfigured: boolean }) {
  const client = useQueryClient(),
    query = useQuery({
      queryKey: ["career-os", "discovery-settings"],
      queryFn: getDiscoverySettings,
      refetchInterval: (q) => (q.state.data?.settings?.capability === "queued" ? 1500 : false),
    });
  const [mode, setMode] = useState<DiscoverySettingsInput["mode"]>("existing_sources"),
    [adapter, setAdapter] = useState<SearchAdapter>("auto"),
    [key, setKey] = useState(""),
    [dirty, setDirty] = useState(false),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const s = query.data?.settings;
  useEffect(() => {
    if (query.data && !loaded && !dirty) {
      setMode(s?.mode ?? "existing_sources");
      setAdapter(s?.adapter ?? "auto");
      setLoaded(true);
    }
  }, [query.data, s, loaded, dirty]);
  useEffect(
    () =>
      subscribeToSessionBoundary(() => {
        setKey("");
        setDirty(false);
        setLoaded(false);
        setMode("existing_sources");
        setNotice("");
      }),
    [],
  );
  async function save(legacy = false) {
    setBusy(true);
    setNotice("");
    try {
      const selected = legacy ? "tavily" : mode;
      const result = await putDiscoverySettings({
        expectedRevision: s?.revision ?? 0,
        mode: selected,
        adapter,
        ...(key ? { apiKey: key } : {}),
        useLegacyKey: legacy,
      });
      client.setQueryData(["career-os", "discovery-settings"], result);
      setMode(selected);
      setDirty(false);
      setKey("");
      if (selected !== "existing_sources") {
        await checkDiscoverySettings(result.settings!.revision);
        await query.refetch();
        setNotice("已保存，正在检查搜索能力。搜索只发送公开求职关键词。");
      } else setNotice("已选择只刷新已接入网站，无需配置搜索 Key。");
      await client.invalidateQueries({ queryKey: ["career-os", "discovery-status"] });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "配置未完成，输入仍保留。");
    } finally {
      setBusy(false);
    }
  }
  async function retry() {
    if (!s) return;
    setBusy(true);
    try {
      await checkDiscoverySettings(s.revision);
      await query.refetch();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "检查未完成。");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!s) return;
    setBusy(true);
    try {
      await removeDiscoverySettings(s.revision);
      setLoaded(false);
      setDirty(false);
      setKey("");
      await query.refetch();
      setNotice("搜索密钥已删除，保留已接网站刷新。");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "删除未完成。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="discovery-settings" aria-labelledby="discovery-settings-title">
      <div className="discovery-settings__heading">
        <div>
          <p className="discovery-settings__eyebrow">机会发现</p>
          <h2 id="discovery-settings-title">选择怎样发现新机会</h2>
          <p>先用已有官网，再按需要扩展。搜索和 AI 写作可以分别选择。</p>
        </div>
        <Link className="career-button" to="/jobs">
          返回发现机会
        </Link>
      </div>
      {query.isError ? (
        <p role="alert">
          搜索设置暂时无法读取。
          <button type="button" onClick={() => void query.refetch()}>
            重新读取
          </button>
        </p>
      ) : null}
      {!s && query.data?.legacyAvailable ? (
        <div className="discovery-settings__legacy">
          <div>
            <strong>本机已保存 Tavily 配置</strong>
            <p>现有搜索继续使用原配置。沿用后，可直接在这里管理，无需再填 Key。</p>
          </div>
          <button type="button" disabled={busy} onClick={() => void save(true)}>
            沿用本机搜索配置
          </button>
        </div>
      ) : null}
      <fieldset className="discovery-settings__choices" disabled={busy || query.isPending}>
        <legend>新网站搜索方式</legend>
        {modes.map((item) => (
          <label key={item.value} className={mode === item.value ? "is-selected" : ""}>
            <input
              type="radio"
              name="discovery-mode"
              checked={mode === item.value}
              onChange={() => {
                setMode(item.value);
                setDirty(true);
              }}
            />
            <span>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {mode === "ai_connection" ? (
        <div className="discovery-settings__detail">
          <p>
            {aiConfigured
              ? "会检查下方已保存的 AI 连接。更换地址或模型后需要重新检查，不会自动换用其他服务。"
              : "先在下方保存并启用 AI 连接，再回来检查搜索能力。"}
          </p>
          <details>
            <summary>高级：搜索接口适配</summary>
            <label className="studio-label">
              适配方式
              <select
                value={adapter}
                onChange={(e) => {
                  setAdapter(e.target.value as SearchAdapter);
                  setDirty(true);
                }}
              >
                <option value="auto">自动识别 / 通用 Responses</option>
                <option value="openai-responses">OpenAI Responses 兼容</option>
                <option value="bailian-responses">百炼 Responses</option>
                <option value="openrouter">OpenRouter 搜索工具</option>
              </select>
            </label>
          </details>
        </div>
      ) : null}
      {mode === "tavily" ? (
        <div className="discovery-settings__detail">
          <label className="studio-label">
            Tavily API Key
            <input
              type="password"
              autoComplete="new-password"
              value={key}
              placeholder={
                s?.keyConfigured && s.mode === "tavily"
                  ? "已保存，留空保留"
                  : "填写 Tavily 控制台的 Key"
              }
              onChange={(e) => {
                setKey(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          <p>
            <a href="https://app.tavily.com" target="_blank" rel="noreferrer">
              打开 Tavily 控制台 ↗
            </a>{" "}
            · 每日最多 20 次、每月 500 次请求，失败尝试也计入。
          </p>
        </div>
      ) : null}
      <div className="discovery-settings__actions">
        <button
          type="button"
          className="studio-primary"
          disabled={
            busy || query.isPending || query.isError || (mode === "ai_connection" && !aiConfigured)
          }
          onClick={() => void save()}
        >
          {busy ? "正在处理…" : mode === "existing_sources" ? "保存选择" : "保存并检查搜索"}
        </button>
        {s?.mode !== "existing_sources" &&
        s &&
        s.capability !== "ready" &&
        s.capability !== "queued" &&
        !dirty ? (
          <button type="button" disabled={busy} onClick={() => void retry()}>
            重新检查
          </button>
        ) : null}
        {s?.keyConfigured && s.mode === "tavily" ? (
          <button type="button" disabled={busy} onClick={() => void remove()}>
            删除搜索密钥
          </button>
        ) : null}
      </div>
      {notice ? <output>{notice}</output> : null}
      {s ? (
        <div className="discovery-settings__status" aria-live="polite">
          <strong>
            {s.mode === "existing_sources" ? "只刷新已接网站" : statusText[s.capability]}
          </strong>
          {s.capabilityCode ? (
            <p>{errorText[s.capabilityCode] ?? "本次检查未完成；已接来源刷新不受影响。"}</p>
          ) : null}
          {s.mode !== "existing_sources" ? (
            <p>
              本日请求 {query.data?.usage.dailyUsed} / 20 · 本月请求 {query.data?.usage.monthlyUsed}{" "}
              / 500
              {s.checkedAt ? ` · 最近检查 ${new Date(s.checkedAt).toLocaleString("zh-CN")}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="discovery-settings__note">
        保存并检查会使用一次搜索及可能的模型用量。新网站是待核验线索，核验接入后才作为岗位刷新；只看已有岗位、写简历和下载文件均不需要搜索服务。
      </p>
    </section>
  );
}
