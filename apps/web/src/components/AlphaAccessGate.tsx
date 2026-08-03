import { type FormEvent, type PropsWithChildren, useEffect, useState } from "react";
import { createAlphaSession, getSessionStatus } from "../api/client";

type AccessState = "checking" | "required" | "submitting" | "authenticated";

export function AlphaAccessGate({ enabled, children }: PropsWithChildren<{ enabled: boolean }>) {
  const [state, setState] = useState<AccessState>(enabled ? "checking" : "authenticated");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setState("authenticated");
      return;
    }

    const controller = new AbortController();
    getSessionStatus(controller.signal)
      .then((session) => setState(session.authenticated ? "authenticated" : "required"))
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setError(requestError instanceof Error ? requestError.message : "暂时无法检查访问状态。请稍后重试。");
        setState("required");
      });
    return () => controller.abort();
  }, [enabled]);

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "submitting") return;
    setError(null);
    setState("submitting");
    try {
      const session = await createAlphaSession(inviteCode);
      if (!session.authenticated) throw new Error("访问会话没有建立，请重试。");
      setInviteCode("");
      setState("authenticated");
    } catch (requestError) {
      setInviteCode("");
      setError(requestError instanceof Error ? requestError.message : "访问凭证未通过校验。");
      setState("required");
    }
  }

  if (state === "authenticated") return children;

  return (
    <main className="alpha-access" aria-labelledby="alpha-access-title">
      <section className="alpha-access__panel">
        <span className="alpha-access__mark" aria-hidden="true">
          A
        </span>
        <p className="eyebrow">Private Alpha</p>
        <h1 id="alpha-access-title">
          {state === "checking" ? "正在确认访问状态" : "输入访问凭证继续"}
        </h1>
        <p>
          Aijob 仍处于小范围验证阶段。访问凭证只用于建立匿名会话，不收集手机号或邮箱。
        </p>
        {state !== "checking" ? (
          <form className="alpha-access__form" onSubmit={submitInvite}>
            <label htmlFor="alpha-invite-code">访问凭证</label>
            <input
              id="alpha-invite-code"
              name="inviteCode"
              type="password"
              autoComplete="off"
              minLength={16}
              maxLength={256}
              required
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
            />
            {error ? <p className="filter-inline-error" role="alert">{error}</p> : null}
            <button className="button button--primary" type="submit" disabled={state === "submitting"}>
              {state === "submitting" ? "正在验证…" : "进入 Aijob"}
            </button>
          </form>
        ) : (
          <output>正在安全检查当前匿名会话…</output>
        )}
      </section>
    </main>
  );
}
