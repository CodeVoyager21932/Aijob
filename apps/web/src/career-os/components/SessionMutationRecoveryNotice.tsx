import { useEffect, useState } from "react";
import { subscribeToSessionMutationRecovery } from "../../api/client";
import { Icon } from "./Icon";

export function SessionMutationRecoveryNotice() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => subscribeToSessionMutationRecovery(setMessage), []);

  if (!message) return null;
  return (
    <section className="career-session-mutation-notice" role="alert" aria-live="assertive">
      <Icon name="warning" size={18} />
      <div>
        <strong>会话已恢复，修改等待你重新确认</strong>
        <span>{message}</span>
      </div>
      <button type="button" onClick={() => setMessage(null)}>
        知道了
      </button>
    </section>
  );
}
