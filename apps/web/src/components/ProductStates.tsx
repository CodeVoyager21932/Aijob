import type { ReactNode } from "react";

export function ProductLoading({ label = "正在读取" }: { label?: string }) {
  return (
    <output className="product-state" aria-live="polite">
      <span className="product-spinner" aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        <p>数据仍保留在本机，请稍候。</p>
      </div>
    </output>
  );
}

export function ProductError({
  title = "暂时无法完成",
  error,
  action,
}: {
  title?: string;
  error: unknown;
  action?: ReactNode;
}) {
  return (
    <section className="product-state product-state--error" role="alert">
      <span aria-hidden="true">!</span>
      <div>
        <strong>{title}</strong>
        <p>{error instanceof Error ? error.message : "请稍后重试。"}</p>
        {action}
      </div>
    </section>
  );
}

export function ProductEmpty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="product-state">
      <span aria-hidden="true">○</span>
      <div>
        <strong>{title}</strong>
        <div className="product-state__copy">{children}</div>
        {action}
      </div>
    </section>
  );
}

export function JourneySteps({ current }: { current: 1 | 2 | 3 | 4 }) {
  const steps = ["浏览岗位", "确认简历证据", "查看推荐", "优化并投递"];
  return (
    <ol className="journey-steps" aria-label="当前流程">
      {steps.map((label, index) => {
        const step = (index + 1) as 1 | 2 | 3 | 4;
        return (
          <li
            key={label}
            className={step === current ? "is-current" : step < current ? "is-done" : ""}
            aria-current={step === current ? "step" : undefined}
          >
            <span>{step}</span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}
