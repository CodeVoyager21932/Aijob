import type { UserAiSettingsInputSchema } from "@aijob/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { z } from "zod";
import { subscribeToSessionBoundary } from "../../api/client";
import {
  deleteUserAiSettings,
  getUserAiModels,
  getUserAiSettings,
  saveUserAiSettings,
  testUserAiSettings,
} from "../../api/user-ai";
import { aiFailureMessage } from "./ai-errors";
import { DiscoverySettingsCard } from "./DiscoverySettingsCard";
import { LocalRuntimeCard } from "./LocalRuntimeCard";
import "./studio.css";

const defaults: z.input<typeof UserAiSettingsInputSchema> = {
  expectedRevision: 0,
  label: "我的 API",
  baseUrl: "",
  model: "",
  enabled: true,
  jsonMode: "json_object",
  dailyCalls: 100,
  dailyTokens: 2000000,
  concurrency: 2,
  maxOutputTokens: 4096,
  requestTimeoutMs: 60000,
};
export function AiSettingsPage() {
  const client = useQueryClient(),
    query = useQuery({
      queryKey: ["career-os", "user-ai-settings"],
      queryFn: getUserAiSettings,
      refetchInterval: (q) => (q.state.data?.settings?.testStatus === "queued" ? 1200 : false),
    });
  const [form, setForm] = useState({ ...defaults }),
    [secret, setSecret] = useState(""),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [remove, setRemove] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const restoreSaved = useCallback(() => {
    const s = query.data?.settings;
    setForm(
      s
        ? {
            expectedRevision: s.revision,
            label: s.label,
            protocol: s.protocol,
            baseUrl: s.baseUrl,
            model: s.model,
            enabled: s.enabled,
            jsonMode: s.jsonMode,
            dailyCalls: s.dailyCalls,
            dailyTokens: s.dailyTokens,
            concurrency: s.concurrency,
            maxOutputTokens: s.maxOutputTokens,
            requestTimeoutMs: s.requestTimeoutMs,
          }
        : { ...defaults },
    );
    setSecret("");
    setDirty(false);
    setLoaded(true);
  }, [query.data]);
  useEffect(() => {
    if (query.data && !loaded && !dirty) restoreSaved();
  }, [query.data, loaded, dirty, restoreSaved]);
  useEffect(
    () =>
      subscribeToSessionBoundary(() => {
        setSecret("");
        setForm({ ...defaults });
        setDirty(false);
        setLoaded(false);
        setNotice("");
      }),
    [],
  );
  function field<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((v) => ({ ...v, [key]: value }));
    setDirty(true);
  }
  async function save() {
    setBusy(true);
    setNotice("");
    try {
      const result = await saveUserAiSettings({ ...form, ...(secret ? { apiKey: secret } : {}) });
      client.setQueryData(["career-os", "user-ai-settings"], result);
      setForm((v) => ({ ...v, expectedRevision: result.settings!.revision }));
      setSecret("");
      setDirty(false);
      setNotice("已保存。求职助手会使用你配置的接口与模型。");
      await client.invalidateQueries({ queryKey: ["career-os", "assistant-status"] });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败，输入仍保留。");
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    if (!query.data?.settings) return;
    setBusy(true);
    try {
      await testUserAiSettings(query.data.settings.revision);
      await query.refetch();
      setNotice("已发起一条简短的连接测试。结果会显示在这里。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "测试未完成。");
    } finally {
      setBusy(false);
    }
  }
  async function erase() {
    if (!query.data?.settings) return;
    setBusy(true);
    try {
      await deleteUserAiSettings(query.data.settings.revision);
      setLoaded(false);
      setRemove(false);
      await query.refetch();
      await client.invalidateQueries({ queryKey: ["career-os", "assistant-status"] });
      setNotice("API 配置与密钥已删除，已有简历和对话仍在。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除失败。");
    } finally {
      setBusy(false);
    }
  }
  const s = query.data?.settings,
    usage = query.data?.usage;
  return (
    <section className="resume-studio ai-settings-page">
      <header className="career-page-heading">
        <div>
          <p>资料与设置</p>
          <h1>连接与运行</h1>
          <p>
            先选择机会从哪里来，再按需要接入写作助手。已有官网刷新和手动准备简历，无需配置两份 Key。
          </p>
        </div>
        <Link className="career-button" to="/settings/data">
          账户与资料
        </Link>
      </header>
      {query.isError ? (
        <p role="alert">
          配置暂时无法读取。
          <button type="button" onClick={() => void query.refetch()}>
            重新读取
          </button>
        </p>
      ) : null}
      {notice ? <output className="studio-alert">{notice}</output> : null}
      <LocalRuntimeCard />
      <DiscoverySettingsCard aiConfigured={!!s?.enabled} />
      <div className="ai-settings-layout">
        <form
          className="ai-settings-card"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h2>AI 写作与整理</h2>
          <div className="studio-fields">
            <label className="studio-label">
              配置名称
              <input
                value={form.label}
                onChange={(e) => field("label", e.target.value)}
                placeholder="方便自己辨认的名称"
                required
                maxLength={80}
              />
            </label>
            <label className="studio-label">
              服务商快捷填写
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) field("baseUrl", e.target.value);
                }}
              >
                <option value="">自定义 / OpenAI 兼容中转</option>
                <option value="https://api.deepseek.com">DeepSeek</option>
                <option value="https://api.openai.com/v1">OpenAI</option>
                <option value="https://dashscope.aliyuncs.com/compatible-mode/v1">
                  阿里云百炼
                </option>
                <option value="https://openrouter.ai/api/v1">OpenRouter</option>
              </select>
            </label>
            <label className="studio-label studio-field-wide">
              API 地址
              <input
                type="url"
                value={form.baseUrl}
                onChange={(e) => field("baseUrl", e.target.value)}
                placeholder="https://你的供应商地址/v1"
                required
                autoComplete="off"
              />
              <small>可填写服务商提供的 Base URL，或完整的 /chat/completions 地址。</small>
            </label>
            <label className="studio-label studio-field-wide">
              API Key
              <input
                type="password"
                value={secret}
                onChange={(e) => {
                  setSecret(e.target.value);
                  setDirty(true);
                }}
                placeholder={
                  s?.keyConfigured ? "已保存；留空保留现有密钥" : "填写你在服务商处创建的密钥"
                }
                autoComplete="new-password"
                required={!s?.keyConfigured}
              />
            </label>
            <label className="studio-label">
              模型名称
              <input
                value={form.model}
                onChange={(e) => field("model", e.target.value)}
                placeholder="填写 API 文档中的模型标识"
                required
                maxLength={180}
                list="provider-models"
              />
              <datalist id="provider-models">
                {models.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
              <button
                type="button"
                disabled={busy || dirty || !s?.enabled}
                onClick={() => {
                  setBusy(true);
                  void getUserAiModels()
                    .then((result) => {
                      setModels(result.models);
                      setNotice(
                        result.notice ??
                          `已读取 ${result.models.length} 个模型，可选取或继续手填。`,
                      );
                    })
                    .catch(() => setNotice("模型列表暂不可用，直接填写服务商提供的模型名称即可。"))
                    .finally(() => setBusy(false));
                }}
              >
                读取已保存连接的模型列表
              </button>
            </label>
          </div>
          <label className="studio-checkbox">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => field("enabled", e.target.checked)}
            />
            启用我的 AI 接口
          </label>
          <details className="ai-settings-limits">
            <summary>高级设置：兼容方式、用量与等待时间</summary>
            <label className="studio-label">
              返回格式
              <select
                value={form.jsonMode}
                onChange={(e) => field("jsonMode", e.target.value as "json_object" | "prompt")}
              >
                <option value="json_object">接口原生 JSON 模式</option>
                <option value="prompt">兼容模式（通过提示词返回 JSON）</option>
              </select>
            </label>
            <p>
              限制按最近 24 小时计算，失败请求也计入次数。Token
              使用保守估算控制，实际费用以你的服务商账单为准。
            </p>
            <div className="studio-fields">
              {(
                [
                  { key: "dailyCalls", label: "调用次数上限", min: 1, max: 10000 },
                  { key: "dailyTokens", label: "估算 Token 上限", min: 10000, max: 100000000 },
                  { key: "concurrency", label: "同时进行的 AI 任务", min: 1, max: 4 },
                  { key: "maxOutputTokens", label: "单次回答 Token 上限", min: 512, max: 16000 },
                ] as const
              ).map((item) => (
                <label className="studio-label" key={item.key}>
                  {item.label}
                  <input
                    type="number"
                    min={item.min}
                    max={item.max}
                    value={form[item.key]}
                    required
                    onChange={(e) => field(item.key, e.target.valueAsNumber)}
                  />
                </label>
              ))}
              <label className="studio-label">
                单次最长等待（秒）
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={(form.requestTimeoutMs ?? 60000) / 1000}
                  required
                  onChange={(e) => field("requestTimeoutMs", e.target.valueAsNumber * 1000)}
                />
              </label>
            </div>
          </details>
          <div className="ai-settings-actions">
            <button className="studio-primary" type="submit" disabled={busy || query.isPending}>
              保存配置
            </button>
            <button
              type="button"
              disabled={busy || dirty || !s?.enabled || s.testStatus === "queued"}
              onClick={() => void test()}
            >
              {s?.testStatus === "queued" ? "正在测试…" : "测试连接"}
            </button>
            {dirty && s ? (
              <button type="button" onClick={restoreSaved}>
                恢复已保存配置
              </button>
            ) : null}
          </div>
          <small>测试会发送一条不含个人材料的简短请求，使用你的 API 用量。</small>
        </form>
        <aside className="ai-settings-card">
          <h2>连接状态</h2>
          <p>
            {!s
              ? "尚未配置"
              : !s.enabled
                ? "已停用"
                : s.testStatus === "completed"
                  ? "连接与结构化输出测试通过"
                  : s.testStatus === "failed"
                    ? "连接测试未通过"
                    : s.testStatus === "queued"
                      ? "等待模型返回测试结果"
                      : "已保存，可以测试连接"}
          </p>
          {s?.testStatus === "failed" ? (
            <p className="studio-alert">{aiFailureMessage(s.testError)}</p>
          ) : null}
          {usage ? (
            <dl className="ai-usage">
              <div>
                <dt>最近 24 小时调用</dt>
                <dd>{usage.calls}</dd>
              </div>
              <div>
                <dt>完成 / 失败 / 进行中</dt>
                <dd>
                  {usage.completed} / {usage.failed} / {usage.running}
                </dd>
              </div>
              <div>
                <dt>估算 Token 预留量</dt>
                <dd>{usage.reservedTokens.toLocaleString()}</dd>
              </div>
            </dl>
          ) : null}
          <Link className="career-button" to="/assistant">
            打开求职助手
          </Link>
          <p>
            使用 AI 时，当前任务选用的材料会发送到你配置的服务商。手工编辑、导出和投递管理无需配置
            API。
          </p>
          {s ? (
            <div className="ai-settings-remove">
              {remove ? (
                <>
                  <p>删除此配置及密钥？</p>
                  <button type="button" disabled={busy} onClick={() => void erase()}>
                    删除配置与密钥
                  </button>
                  <button type="button" onClick={() => setRemove(false)}>
                    保留
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setRemove(true)}>
                  删除 API 配置
                </button>
              )}
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
