# 本地目录空库恢复

## 入口

```powershell
pnpm local:bootstrap --manifest .data/local-bootstrap.json
```

该命令只允许 `APP_ENV=local` 且 `ENABLE_LOCAL_MVP=true`，按以下顺序执行：

1. 在任何基础设施变更前校验 Git 忽略清单与浏览器快照。
2. 启动 `infra/compose.yaml` 并等待 PostgreSQL 健康。
3. 对 `DATABASE_URL` 指向的空库执行迁移。
4. 顺序登记来源；网络来源执行低频探测，本地快照执行零网络导入。
5. 重物化目录并检查总供给、可见数、企业数和公开岗位数。

## 本地清单

- 清单必须位于 `.data/`，默认路径为 `.data/local-bootstrap.json`。
- 浏览器快照必须位于 `.data/browser-imports/`；任一文件缺失时在启动基础设施前 fail-closed。
- `.data/` 始终 Git 忽略；清单和快照不得提交。
- `expectedCatalog.publicJobs` 固定为 0。任一实际统计与清单不一致时命令失败，不允许用空目录冒充恢复成功。

最小结构：

```json
{
  "schemaVersion": "aijob-local-bootstrap-v1",
  "sources": [
    {
      "sourceKey": "example-source",
      "mode": "probe",
      "limit": 5
    },
    {
      "sourceKey": "example-manual-source",
      "mode": "browser_snapshot",
      "file": ".data/browser-imports/example.json"
    }
  ],
  "expectedCatalog": {
    "totalSupply": 0,
    "visible": 0,
    "companies": 0,
    "publicJobs": 0
  }
}
```

## 隔离演练

不要把恢复演练指向日常使用的 `aijob` 数据库。先创建一次性空库，再临时覆盖连接：

```powershell
$env:DATABASE_URL = "postgresql://aijob:aijob@127.0.0.1:5432/aijob_bootstrap_test"
pnpm local:bootstrap
```

真实来源不可访问、快照缺失、来源失败或统计不一致时，演练应失败并报告第一处原因；不得放宽白名单或跳过来源。
