import { type FormEvent, type PropsWithChildren, useEffect, useRef, useState } from "react";
import {
  completeEmailVerification,
  createEmailVerificationChallenge,
  getSessionStatus,
} from "../api/client";

type AccessState = "checking" | "email" | "sending" | "code" | "verifying" | "authenticated";

function requestKey(): string {
  return `alpha-email:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export function AlphaAccessGate({ enabled, children }: PropsWithChildren<{ enabled: boolean }>) {
  const [state, setState] = useState<AccessState>(enabled ? "checking" : "authenticated");
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [maskedEmail, setMaskedEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!enabled) {
      setState("authenticated");
      return;
    }

    const controller = new AbortController();
    getSessionStatus(controller.signal)
      .then((session) => setState(session.authenticated ? "authenticated" : "email"))
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "暂时无法检查访问状态。请稍后重试。",
        );
        setState("email");
      });
    return () => controller.abort();
  }, [enabled]);

  useEffect(() => {
    if (state === "email") emailInputRef.current?.focus();
    if (state === "code") codeInputRef.current?.focus();
  }, [state]);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending") return;
    setError(null);
    setState("sending");
    try {
      const challenge = await createEmailVerificationChallenge(email, requestKey());
      setChallengeId(challenge.id);
      setMaskedEmail(challenge.maskedEmail);
      setState("code");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "暂时无法发送验证码。");
      setState("email");
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "verifying" || !challengeId) return;
    setError(null);
    setState("verifying");
    try {
      const session = await completeEmailVerification({ challengeId, email, verificationCode });
      if (!session.authenticated) throw new Error("访问会话没有建立，请重试。");
      setVerificationCode("");
      setState("authenticated");
    } catch (requestError) {
      setVerificationCode("");
      setError(requestError instanceof Error ? requestError.message : "验证码未通过校验。");
      setState("code");
    }
  }

  function changeEmail() {
    setChallengeId(null);
    setVerificationCode("");
    setError(null);
    setState("email");
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
          {state === "checking"
            ? "正在确认访问状态"
            : state === "code" || state === "verifying"
              ? "输入邮箱验证码"
              : "验证受邀邮箱继续"}
        </h1>
        <p>
          {state === "code" || state === "verifying"
            ? `验证码已发送至 ${maskedEmail}。验证码只用于登录，不会进入普通日志。`
            : "Aijob 仍处于小范围验证阶段。只有受邀邮箱能够建立长期职业资产账号。"}
        </p>
        {state === "email" || state === "sending" ? (
          <form className="alpha-access__form" onSubmit={requestCode}>
            <label htmlFor="alpha-email">受邀邮箱</label>
            <input
              ref={emailInputRef}
              id="alpha-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            {error ? (
              <p className="filter-inline-error" role="alert">
                {error}
              </p>
            ) : null}
            <button className="button button--primary" type="submit" disabled={state === "sending"}>
              {state === "sending" ? "正在发送…" : "发送验证码"}
            </button>
          </form>
        ) : state === "code" || state === "verifying" ? (
          <form className="alpha-access__form" onSubmit={verifyCode}>
            <label htmlFor="alpha-verification-code">6 位验证码</label>
            <input
              ref={codeInputRef}
              id="alpha-verification-code"
              name="verificationCode"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              required
              value={verificationCode}
              onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, ""))}
            />
            {error ? (
              <p className="filter-inline-error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              className="button button--primary"
              type="submit"
              disabled={state === "verifying"}
            >
              {state === "verifying" ? "正在验证…" : "验证并进入 Aijob"}
            </button>
            <button className="button button--quiet" type="button" onClick={changeEmail}>
              更换邮箱
            </button>
          </form>
        ) : (
          <output>正在安全检查当前会话…</output>
        )}
      </section>
    </main>
  );
}
