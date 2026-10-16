import {
  type LocalAccessStatus,
  type LocalRecoveryFile,
  LocalRecoveryFileSchema,
} from "@aijob/contracts";
import { useState } from "react";
import { createLocalRecoveryFile, restoreLocalAccess } from "../../api/client";

function downloadRecovery(file: LocalRecoveryFile) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `Aijob-恢复文件-${file.workspaceId.slice(0, 8)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function LocalAccessPanel({
  access,
  onGenerated,
  temporaryOwner = false,
}: {
  access: Extract<LocalAccessStatus, { enabled: true }>;
  onGenerated: () => Promise<unknown>;
  temporaryOwner?: boolean;
}) {
  const [prepared, setPrepared] = useState<LocalRecoveryFile | null>(null);
  const [selected, setSelected] = useState<LocalRecoveryFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  async function generate() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const file = await createLocalRecoveryFile();
      setPrepared(file);
      downloadRecovery(file);
      setNotice("下载已发起。请保存恢复文件，之后可用它找回这份资料。");
      await onGenerated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "未能生成恢复文件，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function selectFile(file: File | undefined) {
    setSelected(null);
    setError(null);
    setNotice(null);
    if (!file) return;
    setReading(true);
    try {
      if (file.size > 16 * 1024) throw new Error("文件过大");
      setSelected(LocalRecoveryFileSchema.parse(JSON.parse(await file.text())));
    } catch {
      setError("请选择 Aijob 下载的恢复文件（.json），不是简历或其他文件。");
    } finally {
      setReading(false);
    }
  }

  async function restore() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await restoreLocalAccess(selected.recoveryKey);
      // Discard in-flight requests and caches belonging to the previous workspace.
      window.location.assign("/settings/data?restored=1");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "未能恢复，请重试。");
      setBusy(false);
    }
  }

  return (
    <section className="career-data-panel career-local-access" aria-labelledby="local-access-title">
      <header>
        <div>
          <p>本机网页版</p>
          <h2 id="local-access-title">保留访问与找回资料</h2>
        </div>
      </header>
      <p>
        {temporaryOwner
          ? "浏览器凭据不会延长旧版临时资料的保留期限。请在上方期限内保存材料或绑定邮箱。"
          : access.browserRemembered
            ? "已记住此浏览器。会话到期后会自动续接原资料，无需每月重新配置。"
            : "正在建立此浏览器的访问凭据，请刷新后确认。"}
      </p>
      <div className="career-local-access__backup">
        <strong>保存一份恢复文件</strong>
        <p>清除浏览器数据或换浏览器后，在本机 Aijob 选择这个文件即可找回简历和配置，无需邮箱。</p>
        <small>这是访问凭证，请勿分享；它不包含简历和 API Key，也不能代替数据库备份。</small>
        {access.recoveryCreatedAt ? (
          <small>
            上次生成：{new Date(access.recoveryCreatedAt).toLocaleString("zh-CN")}
            。重新生成后，旧恢复文件失效。
          </small>
        ) : null}
        <div className="career-local-access__actions">
          <button
            className="career-button career-button--primary"
            type="button"
            disabled={busy || reading}
            onClick={() => void generate()}
          >
            {busy ? "正在处理…" : access.recoveryCreatedAt ? "重新生成恢复文件" : "下载恢复文件"}
          </button>
          {prepared ? (
            <button
              className="career-button"
              type="button"
              disabled={busy}
              onClick={() => downloadRecovery(prepared)}
            >
              再次下载刚才的文件
            </button>
          ) : null}
        </div>
      </div>
      <div className="career-local-access__restore">
        <label htmlFor="local-recovery-file">
          <strong>用恢复文件找回资料</strong>
        </label>
        <p>恢复后会切换到文件对应的资料，当前资料继续保留。</p>
        <input
          id="local-recovery-file"
          type="file"
          accept=".json,application/json"
          disabled={busy || reading}
          onChange={(event) => void selectFile(event.target.files?.[0])}
        />
        {selected ? (
          <small>
            已选择恢复文件，生成于 {new Date(selected.createdAt).toLocaleString("zh-CN")}。
          </small>
        ) : null}
        <button
          className="career-button"
          type="button"
          disabled={!selected || busy || reading}
          onClick={() => void restore()}
        >
          恢复文件中的资料
        </button>
      </div>
      {notice ? <output className="career-data-notice">{notice}</output> : null}
      {error ? (
        <p className="career-inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
