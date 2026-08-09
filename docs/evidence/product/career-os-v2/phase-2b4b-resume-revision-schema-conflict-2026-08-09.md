# Phase 2B-4B Resume Revision 幂等 Schema 冲突记录

- 日期：2026-08-09
- 基线：`c0cc1f6 feat(platform): add resume document aggregate API`
- 受影响切片：`Phase 2B-4B Resume Content/Layout Revision API`
- 当前决定：**修改**，在继续服务实现前增加 additive migration 030
- 产品证据：仍为 `E0`；本记录只证明工程契约冲突，不代表用户价值验证

## 1. 可复现冲突

2B-4B 固定要求正文与布局 POST 同时具备以下语义：

1. `Idempotency-Key` 同键同请求在进程重启后仍返回原始结果；
2. 同键不同请求稳定返回冲突；
3. 文档后来继续修订后，旧请求重放仍返回当时的修订和聚合 revision；
4. 同一 legacy V1 来源不能形成两个仍存续的 V2 基础简历真源。

当前 `profile.resume_document_revisions` 与 `profile.resume_layout_revisions` 只保存语义内容、链式 revision 和 content hash，没有请求键、请求哈希或原始聚合 revision。现有 advisory lock 只能串行化当前事务，不能在事务结束或进程重启后充当持久回执。只比较 content hash 也无法区分不同 `expectedRevision`、base revision 或同键不同请求。

同时，2B-4A 已允许先创建空 base 聚合，而旧设计写的是“从 legacy 直接创建新 base”。如果不增加持久 legacy 绑定，同一旧 revision 可以初始化多个空 base，产生重复基础真源。

## 2. 收口决定

采用 migration 030 做最小前向扩展，不创建第二套数据库或通用事件系统：

- 两类不可变修订增加 nullable mutation idempotency key、request hash 与 result document revision；旧行保持 NULL、值不改。
- 分别增加 owner + document + mutation key 的部分唯一索引；新服务写入回执，幂等重放从不可变修订恢复原结果。
- 正文修订额外增加 nullable `legacy_source_revision_id` 和同 owner 外键；首个 legacy 转换写入该引用，并以部分唯一索引阻止同一旧来源同时形成两个 V2 真源。
- 历史 V1、旧 `resume-document-v2` 和 `resume-layout-v1` 行继续可读；不做 contract migration。
- migration forward-only；应用回退不删除新列或新修订。
- 新 V2 正文继续取得 owner 内唯一的兼容 `revision`，但旧全局 `base_revision` 写 NULL；真实编辑链只使用同文档 `base_document_revision_id`。否则不同 Resume Document 会通过旧全局链互相引用，单项删除会被跨文档外键阻塞。

## 3. 首次编辑唯一语义

2B-4A 已建立真实 Resume Document 聚合，因此 2B-4B 不再从 legacy 隐式创建第二个聚合：

```text
POST 创建空 base 聚合（revision=1）
-> GET legacy 只读转换（零写入）
-> POST 该 document 的首个正文修订
   expectedRevision=0 + legacySourceRevisionId
-> 同一事务创建 content revision 1 + 默认 layout revision 1
-> 推进两个 current pointer 和聚合 revision
```

`expectedRevision=0` 是“该聚合尚无正文”的显式哨兵；服务还必须验证聚合仍为初始空 base、两个 current pointer 均为空。Case-derived 空聚合则使用其真实聚合 revision，并且首个正文只能从聚合已固定的基础正文 revision 开始。

## 4. 必须补充的证据

- migration 030 在旧 029 Schema 上 additive 执行，旧行值不变。
- 同键并发、进程无关重放、同键不同请求和 stale expected revision。
- legacy 转换 GET 零写入、ID/文本保持、跨 owner/epoch 404。
- 同一 legacy 来源第二次初始化被数据库与服务共同拒绝；删除 V2 文档后不复活旧请求。
- 新修订继续受既有 no-update trigger、owner epoch guard、复合外键与 owner 全量删除覆盖。

完成以上证据后，2B-4B 再作最终“继续、修改、回退、停止”决定。
