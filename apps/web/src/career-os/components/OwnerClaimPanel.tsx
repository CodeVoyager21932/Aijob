import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  completeOwnerClaim,
  createIdempotencyKey,
  createOwnerClaimChallenge,
} from "../../api/client";

type ClaimState = "email" | "sending" | "code" | "verifying" | "completed";

export function OwnerClaimPanel({
  ownerEpoch,
  onClaimed,
}: {
  ownerEpoch: number;
  onClaimed: () => Promise<void>;
}) {
  const [state, setState] = useState<ClaimState>("email");
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [maskedEmail, setMaskedEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

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
      const challenge = await createOwnerClaimChallenge(
        { email, expectedOwnerEpoch: ownerEpoch },
        createIdempotencyKey("owner-claim"),
      );
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
    if (!challengeId || state === "verifying") return;
    setError(null);
    setState("verifying");
    try {
      const session = await completeOwnerClaim({
        challengeId,
        email,
        verificationCode,
        expectedOwnerEpoch: ownerEpoch,
      });
      if (!session.authenticated || session.owner.epoch !== ownerEpoch) {
        throw new Error("认领后的会话与当前数据不一致，请刷新后重试。");
      }
      setVerificationCode("");
      setState("completed");
      await onClaimed();
    } catch (requestError) {
      setVerificationCode("");
      setError(requestError instanceof Error ? requestError.message : "验证码未通过校验。");
      setState("code");
    }
  }

  function changeEmail() {
    setChallengeId(null);
    setMaskedEmail("");
    setVerificationCode("");
    setError(null);
    setState("email");
  }

  return (
    <section className="career-data-claim" aria-labelledby="owner-claim-title">
      <div>
        <p>保留当前数据</p>
        <h2 id="owner-claim-title">用邮箱认领这个本机身份</h2>
        <span>
          验证成功后，当前 owner 和已有职业资产不会迁移或复制，只会改为由账号长期管理。
        </span>
      </div>
      {state === "email" || state === "sending" ? (
        <form onSubmit={requestCode}>
          <label htmlFor="owner-claim-email">邮箱</label>
          <input
            ref={emailInputRef}
            id="owner-claim-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {error ? <p role="alert">{error}</p> : null}
          <button className="career-button career-button--primary" type="submit" disabled={state === "sending"}>
            {state === "sending" ? "正在发送…" : "发送验证码"}
          </button>
        </form>
      ) : state === "code" || state === "verifying" ? (
        <form onSubmit={verifyCode}>
          <span>验证码已发送至 {maskedEmail}</span>
          <label htmlFor="owner-claim-code">6 位验证码</label>
          <input
            ref={codeInputRef}
            id="owner-claim-code"
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
          {error ? <p role="alert">{error}</p> : null}
          <button className="career-button career-button--primary" type="submit" disabled={state === "verifying"}>
            {state === "verifying" ? "正在验证…" : "验证并认领"}
          </button>
          <button className="career-button career-button--quiet" type="button" onClick={changeEmail}>
            更换邮箱
          </button>
        </form>
      ) : (
        <output>认领成功，正在刷新数据保留状态…</output>
      )}
    </section>
  );
}
