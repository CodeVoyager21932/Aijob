export function ProductUnavailablePage() {
  return (
    <main className="state-panel" aria-labelledby="unavailable-title">
      <span className="state-panel__icon" aria-hidden="true">
        A
      </span>
      <div>
        <h1 id="unavailable-title">Aijob 尚未公开开放</h1>
        <p>研究与内部复核页面只在本地和测试环境注册，当前生产构建不会提供这些入口。</p>
      </div>
    </main>
  );
}
