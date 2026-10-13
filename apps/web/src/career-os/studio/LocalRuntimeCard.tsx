import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

type Catalog = {
  version: string;
  enabled: boolean;
  selected: string[];
  sources: { sourceKey: string; name: string; officialUrl: string; description: string }[];
};
type RuntimeStatus = {
  phase: string;
  message: string;
  autostart: boolean;
  dataRoot: string;
  version: string;
  packaged: boolean;
};
type LegacyWorkspace = {
  directory: string;
  owners: { id: string; epoch: number; resumes: number; directions: number; connections: number }[];
};
declare global {
  interface Window {
    aijobDesktop?: {
      status: () => Promise<RuntimeStatus>;
      sources: () => Promise<Catalog>;
      selectSources: (input: {
        sourceKeys: string[];
        enabled: boolean;
        confirmed: true;
      }) => Promise<Catalog>;
      startup: (enabled: boolean) => Promise<boolean>;
      openLogs: () => Promise<unknown>;
      exportBackup: () => Promise<unknown>;
      importBackup: () => Promise<unknown>;
      selectLegacy: () => Promise<LegacyWorkspace | null>;
      importLegacy: (ownerId: string) => Promise<unknown>;
      quit: () => Promise<void>;
    };
  }
}
export function LocalRuntimeCard() {
  const desktop = window.aijobDesktop,
    client = useQueryClient();
  const catalog = useQuery({
    queryKey: ["career-os", "source-catalog"],
    queryFn: async (): Promise<Catalog> => {
      if (desktop) return desktop.sources();
      const response = await fetch("/v1/local-source-catalog");
      if (!response.ok) throw Error("目录暂不可用");
      return response.json();
    },
  });
  const status = useQuery({
    queryKey: ["desktop", "status"],
    queryFn: () => desktop!.status(),
    enabled: !!desktop,
    refetchInterval: 10000,
  });
  const [selected, setSelected] = useState<string[] | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const keys = selected ?? catalog.data?.selected ?? [];
  const [legacy, setLegacy] = useState<LegacyWorkspace | null>(null),
    [legacyOwner, setLegacyOwner] = useState("");
  async function action(run: () => Promise<unknown>) {
    setBusy(true);
    setNotice("");
    try {
      await run();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作未完成。");
    } finally {
      setBusy(false);
    }
  }
  async function save(enabled: boolean) {
    if (!desktop) return;
    await desktop.selectSources({ sourceKeys: keys, enabled, confirmed: true });
    await client.invalidateQueries({ queryKey: ["career-os"] });
    setSelected(null);
    setNotice(
      enabled ? "已保存官网刷新范围，后台将按来源周期更新。" : "已暂停刷新，已保存内容仍可查看。",
    );
  }
  return (
    <section className="discovery-settings" aria-label="本机运行与官网范围">
      <h2>已接入官网</h2>
      <p>
        先<Link to="/jobs">保存求职方向</Link>，再选择持续刷新的官网。已有官网刷新不需要 API Key。
      </p>
      <p>
        {catalog.data
          ? catalog.data.enabled
            ? "持续刷新已开启"
            : "刷新已暂停"
          : catalog.isError
            ? "来源目录暂不可用"
            : "正在读取来源目录…"}
      </p>
      {catalog.data?.sources.map((source) => (
        <label key={source.sourceKey} className="source-catalog-option">
          <input
            type="checkbox"
            disabled={!desktop || busy}
            checked={keys.includes(source.sourceKey)}
            onChange={(event) =>
              setSelected(
                event.target.checked
                  ? [...keys, source.sourceKey]
                  : keys.filter((k) => k !== source.sourceKey),
              )
            }
          />
          <span>
            <strong>{source.name}</strong>
            <small>
              {source.description}{" "}
              <a href={source.officialUrl} target="_blank" rel="noreferrer">
                官网 ↗
              </a>
            </small>
          </span>
        </label>
      ))}
      {desktop ? (
        <div className="discovery-settings__actions">
          <button
            type="button"
            disabled={busy || !keys.length}
            onClick={() => void action(() => save(true))}
          >
            保存范围并持续刷新
          </button>
          <button
            type="button"
            disabled={busy || !catalog.data?.enabled}
            onClick={() => void action(() => save(false))}
          >
            暂停刷新
          </button>
        </div>
      ) : (
        <p>当前沿用本机已启用的来源范围。新增官网由来源维护流程核验后接入。</p>
      )}
      <p className="discovery-settings__note">
        来源目录 {catalog.data?.version ?? "读取中"}
        。城市与岗位类型以实际结果为准；搜索线索经核验后才会成为岗位。
      </p>
      {desktop && (
        <details>
          <summary>本机运行与备份</summary>
          <p>{status.data?.message ?? "读取运行状态…"}</p>
          <label>
            <input
              type="checkbox"
              checked={status.data?.autostart ?? false}
              onChange={(event) =>
                void action(async () => {
                  await desktop.startup(event.target.checked);
                  await status.refetch();
                })
              }
            />{" "}
            登录 Windows 后启动 Aijob
          </label>
          <p>关窗后在托盘继续运行；完全退出或关机后暂停，重开时合并到期变化。</p>
          <p>资料目录：{status.data?.dataRoot}</p>
          <div className="discovery-settings__actions">
            <button type="button" disabled={busy} onClick={() => void action(desktop.exportBackup)}>
              导出完整备份
            </button>
            <button type="button" disabled={busy} onClick={() => void action(desktop.importBackup)}>
              导入备份
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const result = await desktop.selectLegacy();
                  setLegacy(result);
                  setLegacyOwner(result?.owners[0]?.id ?? "");
                })
              }
            >
              迁入原工作区
            </button>
            <button type="button" onClick={() => void desktop.openLogs()}>
              打开运行日志
            </button>
            <button type="button" onClick={() => void desktop.quit()}>
              完全退出
            </button>
          </div>
          {legacy && (
            <div>
              <p>原目录：{legacy.directory}</p>
              <label>
                继续使用的原账户
                <select
                  value={legacyOwner}
                  onChange={(event) => setLegacyOwner(event.target.value)}
                >
                  {legacy.owners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.resumes} 份简历 · {owner.directions} 个方向 · {owner.connections} 个 AI
                      连接（{owner.id.slice(0, 8)}）
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy || !legacyOwner}
                onClick={() => void action(() => desktop.importLegacy(legacyOwner))}
              >
                备份并迁入此账户
              </button>
              {!legacy.owners.length && <p>没有可恢复的有效账户。过期或已删除的账户不会恢复。</p>}
            </div>
          )}
          <p className="discovery-settings__note">
            备份包含简历和连接密钥，由此 Windows 账户加密。导入在独立目录恢复，成功后才切换。
          </p>
        </details>
      )}
      {notice && <output>{notice}</output>}
    </section>
  );
}
