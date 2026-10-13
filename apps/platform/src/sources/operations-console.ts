import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "@aijob/config";
import { RecruitmentPlanDraftSchema } from "@aijob/contracts";
import type { Database } from "@aijob/database";
import Fastify from "fastify";
import { type Kysely, sql } from "kysely";
import { z } from "zod";
import { installRecruitmentPlan } from "../catalog/recruitment-plans.js";
import { hashCanonicalJson } from "../lib/canonical-json.js";
import { getDiscoveryStatus } from "../opportunities/discovery.js";
import {
  readOpportunitySettings,
  saveOpportunitySettings,
} from "../opportunities/local-settings.js";
import { opportunitySetupHtml } from "../opportunities/setup-page.js";
import {
  draftDiscoveryLead,
  LeadDraftRequestSchema,
  listDiscoveryLeads,
} from "../opportunities/source-leads.js";
import { sourceAutomationMetrics } from "./automation-metrics.js";
import { sourceExceptionEvidence } from "./exception-review.js";
import { readLocalRefreshControl } from "./local-refresh-control.js";
import {
  ConfigurationProposalSchema,
  installSourceProposal,
  reconcileSourceInstallation,
  suggestSourceExtraction,
  validateSourceProposal,
} from "./onboarding-service.js";
import { loadSourceConfig } from "./source-config.js";
import { getSourceInventory } from "./source-inventory.js";
import {
  disableLocalSourceRefresh,
  enableLocalSourceRefresh,
  getLocalSourceRefreshStatus,
  requestLocalSourceRefresh,
} from "./source-refresh-operations.js";
import { getTenantOnboarding, queueTenantOnboarding } from "./tenant-onboarding-queue.js";

const KeySchema = z.string().regex(/^[a-z0-9-]+$/);
const ActionSchema = z.object({
  action: z.enum(["refresh", "resume"]),
  sourceKeys: z.array(KeySchema).min(1).max(100),
  reviewedVersions: z.record(z.number().int().positive()),
});

export function buildOperationsConsole(input: {
  db: Kysely<Database>;
  config: AppConfig;
  port: number;
}) {
  if (input.config.appEnv !== "local") throw new Error("OPERATIONS_CONSOLE_LOCAL_ONLY");
  const app = Fastify({ logger: false, bodyLimit: 3 * 1024 * 1024 });
  const token = randomBytes(32).toString("hex");
  const origin = `http://127.0.0.1:${input.port}`;
  app.addHook("onRequest", async (request, reply) => {
    if (request.headers.host !== `127.0.0.1:${input.port}`)
      return reply.code(403).send({ error: "INVALID_HOST" });
    if (
      request.method !== "GET" &&
      (request.headers.origin !== origin || request.headers["x-aijob-ops"] !== token)
    )
      return reply.code(403).send({ error: "OPERATOR_CONTEXT_REQUIRED" });
  });
  app.addHook("onSend", async (_request, reply, payload) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header(
        "Content-Security-Policy",
        `default-src 'none'; script-src 'nonce-${token}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
      );
    return payload;
  });
  app.setErrorHandler((error, _request, reply) =>
    reply
      .code(error instanceof z.ZodError ? 400 : 409)
      .send({ error: error instanceof Error ? error.message : "OPERATIONS_FAILED" }),
  );
  const runtime = {
    db: input.db,
    appEnv: input.config.appEnv,
    workspaceRoot: input.config.workspaceRoot,
    includePublicSources: true,
  };
  app.get("/discovery-setup", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(opportunitySetupHtml(token)),
  );
  app.get("/api/discovery/settings", async () => {
    const settings = readOpportunitySettings(input.config);
    const refresh = await getLocalSourceRefreshStatus(runtime);
    const sources = refresh.sources.filter(
      (source) =>
        source.crawlInterval &&
        source.refreshCoverage !== "manual_snapshot" &&
        source.policyStatus !== "paused",
    );
    const selected = sources.filter(
      (source) =>
        !refresh.control.sourceKeys || refresh.control.sourceKeys.includes(source.sourceKey),
    );
    const successes = selected
      .flatMap((source) =>
        source.lastSuccessfulRunAt ? [new Date(source.lastSuccessfulRunAt).toISOString()] : [],
      )
      .sort();
    const nextDue = selected
      .filter((source) => !source.automationPaused)
      .flatMap((source) => (source.nextDueAt ? [source.nextDueAt] : []))
      .sort();
    return {
      search: await getDiscoveryStatus(input.db, new Date(), settings),
      refresh: {
        enabled: refresh.control.enabled,
        networkEnabled: settings.sourceNetworkEnabled,
        sourceCount: selected.length,
        configuredSourceCount: sources.length,
        sources: selected.map((source) => source.sourceKey),
        lastSuccessAt: successes.at(-1) ?? null,
        nextDueAt: nextDue[0] ?? null,
      },
    };
  });
  app.post("/api/discovery/settings", async (request) => {
    const body = z
      .object({ enabled: z.boolean(), apiKey: z.string().trim().min(1).max(8192).optional() })
      .strict()
      .parse(request.body);
    const settings = saveOpportunitySettings(input.config, {
      enabled: body.enabled,
      ...(body.apiKey ? { apiKey: body.apiKey } : {}),
    });
    return { configured: !!settings.apiKey, enabled: settings.enabled };
  });
  app.get("/api/sources", async () => ({
    inventory: await getSourceInventory(),
    refresh: await getLocalSourceRefreshStatus(runtime),
  }));
  app.get("/api/metrics", async () => sourceAutomationMetrics(input.db));
  app.get("/api/discovery/leads", async () => listDiscoveryLeads(input.db));
  app.post("/api/source-onboarding", async (request) =>
    queueTenantOnboarding(input.db, request.body),
  );
  app.get("/api/source-onboarding/:id", async (request, reply) => {
    const row = await getTenantOnboarding(
      input.db,
      z.object({ id: z.string().uuid() }).parse(request.params).id,
    );
    return row ?? reply.code(404).send({ error: "SOURCE_PROBE_NOT_FOUND" });
  });
  app.post("/api/discovery/leads/:id/draft", async (request) =>
    draftDiscoveryLead(
      input.db,
      z.object({ id: z.string().uuid() }).parse(request.params).id,
      LeadDraftRequestSchema.parse(request.body),
    ),
  );
  app.post("/api/discovery/leads/:id/reject", async (request) => {
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    await sql`UPDATE source_control.discovery_leads SET status='rejected' WHERE id=${id}::uuid AND status<>'configured'`.execute(
      input.db,
    );
    return { id, status: "rejected" };
  });
  app.get("/api/exceptions", async () => {
    const results =
      await sql`SELECT source.source_key, run.id, run.completion, run.automation_acceptance,
      run.request_count, run.normalized_count, run.error_summary, run.access_observations,
      run.started_at, run.finished_at,
      (SELECT count(*) FROM ingestion.source_job_records record WHERE record.source_id = source.id) AS affected_records
      FROM ingestion.crawl_runs run JOIN source_control.sources source ON source.id = run.source_id
      WHERE run.completion <> 'complete' OR run.automation_acceptance = 'rejected'
      ORDER BY run.started_at DESC LIMIT 100`.execute(input.db);
    return { items: results.rows };
  });
  app.post("/api/recruitment-plans", async (request) =>
    installRecruitmentPlan({ db: input.db, draft: RecruitmentPlanDraftSchema.parse(request.body) }),
  );
  app.get("/api/exceptions/:runId", async (request, reply) => {
    const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params);
    const { offset } = z
      .object({ offset: z.coerce.number().int().min(0).max(1000000).default(0) })
      .parse(request.query);
    const result = await sourceExceptionEvidence(input.db, runId, offset);
    return result ?? reply.code(404).send({ error: "CRAWL_RUN_NOT_FOUND" });
  });
  app.get("/api/configuration/:sourceKey", async (request) => {
    const { sourceKey } = z.object({ sourceKey: KeySchema }).parse(request.params);
    const configuration = JSON.parse(
      await readFile(
        path.join(input.config.workspaceRoot, "config/sources", `${sourceKey}.json`),
        "utf8",
      ),
    );
    return { configuration, expectedPreviousHash: hashCanonicalJson(configuration) };
  });
  app.post("/api/configuration/preview", async (request) => {
    const proposal = ConfigurationProposalSchema.parse(request.body);
    const checked = validateSourceProposal(proposal);
    await sql`INSERT INTO source_control.operator_actions(source_key,action,proposal_hash,status,completed_at)
      SELECT ${checked.config.sourceKey},'configuration_draft',${checked.proposalHash},'completed',now()
      WHERE NOT EXISTS(SELECT 1 FROM source_control.operator_actions WHERE source_key=${checked.config.sourceKey}
        AND action='configuration_draft' AND proposal_hash=${checked.proposalHash})`.execute(
      input.db,
    );
    return {
      proposalHash: checked.proposalHash,
      sampleResult: checked.sampleResult,
      accessScope: {
        fetchTargets: checked.config.policy.fetchTargets,
        applyTargets: checked.config.policy.applyTargets,
      },
      enabled: checked.config.policy.crawlInterval.enabled,
      publicationStatus: checked.config.policy.status,
      notice:
        "样本提取通过不代表真实来源稳定性或公开资格。核对主体、政策证据、范围变化和版本后方可安装。",
    };
  });
  app.post("/api/configuration/suggest", async (request) => {
    const body = z
      .object({ proposal: ConfigurationProposalSchema, usePublicAi: z.literal(true) })
      .parse(request.body);
    return suggestSourceExtraction({
      db: input.db,
      appConfig: input.config,
      proposal: body.proposal,
    });
  });
  app.post("/api/configuration/install", async (request) => {
    const body = z
      .object({
        proposal: ConfigurationProposalSchema,
        reviewedHash: z.string(),
        confirmedScope: z.literal(true),
        enableRefresh: z.boolean().default(false),
        discoveryLeadId: z.string().uuid().optional(),
      })
      .parse(request.body);
    if (
      body.enableRefresh &&
      !validateSourceProposal(body.proposal).config.policy.crawlInterval.enabled
    )
      throw new Error("SOURCE_REFRESH_NOT_IN_REVIEWED_CONFIGURATION");
    const currentScope = readLocalRefreshControl(input.config.workspaceRoot);
    if (body.enableRefresh && currentScope.enabled && !currentScope.sourceKeys)
      throw new Error("请选择当前持续刷新范围后再接入新来源。");
    const result = await installSourceProposal({
      db: input.db,
      workspaceRoot: input.config.workspaceRoot,
      ...body,
    });
    if (body.discoveryLeadId)
      await sql`UPDATE source_control.discovery_leads SET status='configured' WHERE id=${body.discoveryLeadId}::uuid AND source_key=${String(body.proposal.configuration.sourceKey)}`.execute(
        input.db,
      );
    if (body.enableRefresh) {
      await enableLocalSourceRefresh({
        ...runtime,
        sourceKeys: [...new Set([...(currentScope.sourceKeys ?? []), result.sourceKey])],
      });
    }
    return { ...result, refreshEnabled: body.enableRefresh };
  });
  app.get("/api/configuration/installations", async () => ({
    items: (
      await sql`SELECT id,source_key,status,created_at FROM source_control.operator_actions
      WHERE action='configuration_install' AND status IN ('prepared','failed')
      ORDER BY created_at DESC LIMIT 100`.execute(input.db)
    ).rows,
  }));
  app.post("/api/configuration/reconcile", async (request) => {
    const { actionId } = z.object({ actionId: z.string().uuid() }).parse(request.body);
    return reconcileSourceInstallation({
      db: input.db,
      workspaceRoot: input.config.workspaceRoot,
      actionId,
    });
  });
  app.post("/api/control", async (request) => {
    const { enabled, sourceKeys } = z
      .object({ enabled: z.boolean(), sourceKeys: z.array(KeySchema).min(1).max(100).optional() })
      .parse(request.body);
    if (!enabled) return disableLocalSourceRefresh(runtime);
    const result = await enableLocalSourceRefresh({
      ...runtime,
      ...(sourceKeys ? { sourceKeys } : {}),
    });
    saveOpportunitySettings(input.config, { sourceNetworkEnabled: true });
    return result;
  });
  app.post("/api/actions", async (request) => {
    const body = ActionSchema.parse(request.body);
    const results = [];
    for (const sourceKey of [...new Set(body.sourceKeys)]) {
      try {
        const config = await loadSourceConfig(sourceKey);
        if (body.reviewedVersions[sourceKey] !== config.policy.version)
          throw new Error("SOURCE_POLICY_REVIEW_STALE");
        if (body.action === "resume") {
          if (
            !config.policy.accessPolicyEvidence ||
            config.policy.accessPolicyEvidence.termsOfService.prohibitsAggregation
          )
            throw new Error("ACCESS_POLICY_ASSESSMENT_REQUIRED");
          if (
            !config.policy.crawlInterval.enabled ||
            config.policy.refreshCoverage === "manual_snapshot" ||
            !["approved", "pending_review"].includes(config.policy.status)
          )
            throw new Error("SOURCE_REFRESH_NOT_CONFIGURED");
          await input.db.transaction().execute(async (transaction) => {
            const source = await transaction
              .selectFrom("source_control.sources")
              .select(["id", "current_policy_version"])
              .where("source_key", "=", sourceKey)
              .forUpdate()
              .executeTakeFirstOrThrow();
            if (source.current_policy_version !== config.policy.version)
              throw new Error("SOURCE_POLICY_REVIEW_STALE");
            await transaction
              .updateTable("source_control.source_runtime_states")
              .set({
                automation_paused: false,
                automation_pause_reason: null,
                next_due_at: new Date(),
                updated_at: new Date(),
              })
              .where("source_id", "=", source.id)
              .execute();
            await sql`INSERT INTO source_control.operator_actions(source_key, action, evidence, status, completed_at) VALUES (${sourceKey}, 'resume', ${JSON.stringify({ policyVersion: config.policy.version })}::jsonb, 'completed', now())`.execute(
              transaction,
            );
          });
        } else {
          await requestLocalSourceRefresh({ ...runtime, sourceKey });
          await sql`INSERT INTO source_control.operator_actions(source_key, action, evidence, status, completed_at) VALUES (${sourceKey}, 'refresh', ${JSON.stringify({ policyVersion: config.policy.version })}::jsonb, 'completed', now())`.execute(
            input.db,
          );
        }
        results.push({ sourceKey, success: true });
      } catch (error) {
        results.push({
          sourceKey,
          success: false,
          error: error instanceof Error ? error.message : "ACTION_FAILED",
        });
      }
    }
    return { results };
  });
  app.get("/", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(consoleHtml(token)),
  );
  return app;
}

function consoleHtml(token: string) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aijob 供给工作台</title>
<style>body{font:16px/1.6 system-ui;background:#f5f3ec;color:#243a31;margin:0}main{max-width:1200px;margin:auto;padding:24px}h1{font-size:32px}button,select,textarea{font:inherit}button{padding:8px 16px;background:#244e3d;color:white;border:0;border-radius:6px;margin:4px;cursor:pointer}section{background:white;padding:20px;margin:20px 0;border-radius:12px}table{border-collapse:collapse;min-width:640px;width:100%}td,th{text-align:left;border-bottom:1px solid #ddd;padding:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere}textarea{box-sizing:border-box;width:100%;min-height:230px}#status{white-space:pre-wrap}label{display:block;margin:12px 0}.scroll{overflow:auto}</style>
<main><p>Aijob · 内部运营</p><h1>让更新自动流转，把注意力留给异常</h1><p>此工作台只在本机开放。首次接入或扩大范围需核对证据；刷新不会自动提升公开资格。</p>
<div id="status" role="status" aria-live="polite"></div>
<section><h2>从官方入口识别并试采</h2><p>支持北森当前门户变体。实际读取门户中的租户和招聘分类，核对分页后生成配置；试采不会安装或公开岗位。</p><label>企业名称 <input id="tenant-company"></label><label>官方招聘入口 <input id="tenant-entry" type="url" placeholder="https://企业.zhiye.com/intern/jobs"></label><label>企业官网关联证据 <input id="tenant-evidence" type="url" placeholder="企业官网指向该招聘入口的页面"></label><label>招聘类型 <select id="tenant-category"><option value="3">实习</option><option value="2">校园招聘</option></select></label><label>条款页面（没有单独页面可留空） <input id="tenant-terms-url" type="url"></label><label>条款原句或未发现单独条款的核验说明 <textarea id="tenant-terms" style="min-height:80px"></textarea></label><label><input id="tenant-confirm" type="checkbox">已核对官方主体关联和访问条款，允许读取此主机的入口、robots.txt 及公开岗位列表；没有禁止本次读取的政策。</label><button id="tenant-probe">识别并试采</button><p id="tenant-progress" role="status"></p><div id="tenant-preview"></div></section>
<section><h2>新企业线索</h2><p>搜索仅发现线索，不代表官网或岗位事实。核对企业官网后生成禁用草案；沿用下方配置预览、证据核验和显式启用。</p><button id="load-leads">读取发现线索</button><div id="discovery-leads"></div></section>
<section><h2>来源与刷新</h2><button id="reload">刷新状态</button><button id="enable">启用已配置来源的定时刷新</button><button id="disable">停用定时刷新</button><button id="refresh">刷新选中来源</button><button id="resume">核对后恢复选中来源</button><div class="scroll"><table><thead><tr><th>选择</th><th>企业 / 来源</th><th>技术类型</th><th>公开状态</th><th>政策版本</th></tr></thead><tbody id="sources"></tbody></table></div></section>
<section><h2>自动化运行报告（近 30 天）</h2><p>计划任务包含失败、待执行与暂停来源。无记录显示未测；人工介入按来源计算。接入耗时从首次预览至安装计算，不等于人工工时。</p><pre id="metrics"></pre></section><section><h2>异常复核</h2><p>包含失败、部分完成与被拒绝轮次；保留错误、访问依据和影响记录数量。</p><div id="exceptions"></div><section id="exception-detail" hidden aria-label="岗位证据差异"></section></section>
<section><h2>接入与修复向导</h2><div id="installations"></div><p>载入现有配置或填写新配置。普通网页配置必须附列表、详情 HTML 样本及详情 URL。先预览提取原句与网络范围，再安装该配置版本。</p><select id="existing" aria-label="已有来源配置"></select><button id="load">载入配置</button><label>配置提案（configuration、expectedPreviousHash、可选 sample）<textarea id="proposal" spellcheck="false"></textarea></label><button id="suggest">AI 建议提取配置（需已配置预算）</button><label><input id="enable-new-refresh" type="checkbox">安装后持续刷新此来源（保留原有范围）</label><button id="preview">检查并预览</button><pre id="review"></pre><label><input type="checkbox" id="confirmed">已核对主体、访问政策证据、请求范围变化、提取原句和公开状态</label><button id="install" disabled>安装已核对的配置</button></section><section><h2>企业招聘计划</h2><p>按来源、招聘年份与批次保存官方依据，显式关联岗位版本。新的招聘季不继承旧规则。毕业月份和志愿规则未说明时填 null。</p><label>计划草稿 JSON<textarea id="plan-draft" spellcheck="false" placeholder="sourceKey / planKey / expectedRevision / title / recruitmentYear / batch / graduationWindow / volunteerRules / evidenceUrl / evidenceText / yearQuote / verifiedAt / jobVersionIds / confirmedOfficialEvidence"></textarea></label><button id="save-plan">保存已核验计划与关联</button><pre id="plan-result"></pre></section></main>
<script nonce="${token}">
const token=${JSON.stringify(token)};let sources=[],reviewedHash=null,reviewedBody=null,activeDiscoveryLead=null;
const el=id=>document.getElementById(id); const show=value=>el('status').textContent=typeof value==='string'?value:JSON.stringify(value,null,2);
let tenantRunId=null;
async function api(url,body){const r=await fetch(url,{headers:{'Content-Type':'application/json','x-aijob-ops':token},...(body?{method:'POST',body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok)throw Error(v.error||'操作失败');return v;}
async function reload(){const data=await api('/api/sources');sources=data.inventory;el('sources').replaceChildren();el('existing').replaceChildren();for(const s of sources){const tr=document.createElement('tr');const td=document.createElement('td');const cb=document.createElement('input');cb.type='checkbox';cb.value=s.sourceKey;cb.setAttribute('aria-label','选择'+s.organization);td.append(cb);tr.append(td);for(const value of [s.organization+' / '+s.sourceKey,s.kind,s.status,s.policyVersion]){const cell=document.createElement('td');cell.textContent=String(value);tr.append(cell);}el('sources').append(tr);const o=document.createElement('option');o.value=s.sourceKey;o.textContent=s.organization;el('existing').append(o);}renderExceptions((await api('/api/exceptions')).items);await renderInstallations();el('metrics').textContent=JSON.stringify(await api('/api/metrics'),null,2);show(data.refresh);}
const textNode=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
el('tenant-probe').onclick=async()=>{try{if(!el('tenant-confirm').checked)throw Error('请先核对主体、访问政策和本次请求范围。');const url=new URL(el('tenant-entry').value);const category=el('tenant-category').value;const result=await api('/api/source-onboarding',{sourceKey:url.hostname.split('.')[0].toLowerCase()+(category==='3'?'-internships':'-campus'),companyName:el('tenant-company').value,officialUrl:url.toString(),officialEvidenceUrl:el('tenant-evidence').value,category,termsUrl:el('tenant-terms-url').value||null,termsExcerpt:el('tenant-terms').value,confirmedPublicScope:true});tenantRunId=result.id;el('tenant-probe').disabled=true;el('tenant-preview').replaceChildren();await pollTenant();}catch(e){el('tenant-progress').textContent=e.message;el('tenant-probe').disabled=false;}};
async function pollTenant(){try{const row=await api('/api/source-onboarding/'+tenantRunId);const labels={queued:'已排队，等待采集进程（暂停时不会联网）',running:'正在识别门户并试采',complete:'完整试采完成',explicit_empty:'官方明确返回零条',partial:'试采未完整完成',failed:'本次未完成'};el('tenant-progress').textContent=labels[row.status]||row.status;if(['queued','running'].includes(row.status)){setTimeout(pollTenant,2500);return;}el('tenant-probe').disabled=false;const r=row.result||{};el('tenant-preview').append(textNode('p','实际读取 '+(r.parsedCount||0)+' 条 / 官方总数 '+(r.reportedTotal??'未取得')));if(r.reason)el('tenant-preview').append(textNode('p','原因：'+r.reason+'。不把失败当作空列表，也不据此关闭岗位。'));for(const item of r.preview||[]){const details=document.createElement('details');details.append(textNode('summary',item.title+' · '+item.locations.join('、')),textNode('pre',[item.responsibilities,item.requirements].join(String.fromCharCode(10,10))));el('tenant-preview').append(details);}const diagnostic=textNode('button','导出本次诊断');diagnostic.onclick=()=>{const data={version:1,state:r.state,reason:r.reason,vendor:r.vendor,portalId:r.portalId,categories:r.categories,requestCount:r.requestCount,reportedTotal:r.reportedTotal,parsedCount:r.parsedCount,officialUrl:el('tenant-entry').value};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='aijob-source-diagnostic.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};el('tenant-preview').append(diagnostic);if(r.proposal){const button=textNode('button','使用本次配置进入审核');button.onclick=()=>{el('proposal').value=JSON.stringify(r.proposal,null,2);reviewedHash=null;activeDiscoveryLead=null;el('install').disabled=true;el('proposal').scrollIntoView({block:'start'});};el('tenant-preview').append(button);}}catch(e){el('tenant-progress').textContent='状态读取失败，可重新读取：'+e.message;el('tenant-probe').disabled=false;}}
function renderExceptions(items){el('exceptions').replaceChildren();if(!items.length){el('exceptions').append(textNode('p','当前没有异常轮次。'));return;}
for(const item of items){const card=document.createElement('article');card.append(textNode('h3',item.source_key+' · '+({partial:'部分完成',failed:'采集失败',complete:'验收拒绝'}[item.completion]||'尚未完成')),
textNode('p','本轮规范化 '+item.normalized_count+' 条 · 来源关联 '+item.affected_records+' 条记录 · '+new Date(item.started_at).toLocaleString('zh-CN')),
textNode('p','失败或不完整轮次不会据此批量下架。请核对分页、访问政策、提取字段和来源变化。'));
const detail=document.createElement('details');detail.append(textNode('summary','异常原因与访问记录'),textNode('pre',JSON.stringify({errors:item.error_summary,access:item.access_observations},null,2)));card.append(detail);
const open=textNode('button','查看本轮岗位与原句差异');open.onclick=()=>loadException(item.id,0).catch(e=>show(e.message));card.append(open);el('exceptions').append(card);}}
async function loadException(runId,offset){const result=await api('/api/exceptions/'+runId+'?offset='+offset),panel=el('exception-detail');panel.hidden=false;if(!offset){panel.replaceChildren(textNode('h3','本轮采集证据 · '+result.run.source_key));panel.append(textNode('p','仅展示本轮实际观察到的修订；未观察到的岗位不据此判定关闭。'));}
for(const item of result.items){const card=document.createElement('article');card.append(textNode('h4',item.title+(item.isNew?' · 首次记录':'')));
for(const change of item.changes){card.append(textNode('strong',({title:'岗位名称',requirements:'任职要求',responsibilities:'工作职责',locations:'地点',applyUrl:'投递地址'}[change.field]||change.field)),textNode('pre','之前：'+(typeof change.before==='string'?change.before:JSON.stringify(change.before))),textNode('pre','本轮：'+(typeof change.after==='string'?change.after:JSON.stringify(change.after))));}if(!item.changes.length)card.append(textNode('p','原句与字段未变化。'));panel.append(card);}
if(!result.items.length)panel.append(textNode('p','本轮未保存岗位修订，请先查看访问与分页错误。'));
if(result.nextOffset!==null){const more=textNode('button','继续查看岗位');more.onclick=()=>{more.remove();loadException(runId,result.nextOffset).catch(e=>show(e.message));};panel.append(more);}if(!offset)panel.scrollIntoView({block:'start'});}
async function renderInstallations(){const panel=el('installations');panel.replaceChildren();for(const item of (await api('/api/configuration/installations')).items){const row=document.createElement('p');row.append(textNode('span',item.source_key+' · 配置安装未完成 '));const retry=textNode('button','核对已安装版本并恢复');retry.onclick=()=>api('/api/configuration/reconcile',{actionId:item.id}).then(async result=>{show(result);await renderInstallations();}).catch(e=>show(e.message));row.append(retry);panel.append(row);}}
const action=async kind=>{const keys=[...el('sources').querySelectorAll('input:checked')].map(x=>x.value);show(await api('/api/actions',{action:kind,sourceKeys:keys,reviewedVersions:Object.fromEntries(sources.map(s=>[s.sourceKey,s.policyVersion]))}));};
const bind=(id,fn)=>el(id).onclick=()=>Promise.resolve().then(fn).catch(e=>show(e.message));
bind('load-leads',async()=>{const panel=el('discovery-leads');panel.replaceChildren();const data=await api('/api/discovery/leads');if(!data.items.length)panel.append(textNode('p','暂无新线索；确认已有启用的方向订阅和搜索服务配置。'));for(const item of data.items){const card=document.createElement('article');card.append(textNode('h3',item.title),textNode('p',item.canonical_url+' · '+item.status));if(item.status!=='configured'&&item.status!=='rejected'){const fields={};for(const [key,label,value] of [['sourceKey','来源标识（英文小写及连字符）',''],['companyName','已核对的企业名称',''],['officialUrl','企业官方招聘入口',item.canonical_url]]){const box=document.createElement('label'),field=document.createElement('input');box.append(textNode('span',label));field.value=value;box.append(field);card.append(box);fields[key]=field;}const draft=textNode('button','生成禁用草案');draft.onclick=async()=>{try{const result=await api('/api/discovery/leads/'+item.id+'/draft',Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value])));el('proposal').value=JSON.stringify(result.proposal,null,2);activeDiscoveryLead=item.id;reviewedHash=null;el('install').disabled=true;show(result.notice);el('proposal').scrollIntoView({block:'start'});}catch(e){show(e.message);}};const reject=textNode('button','忽略此线索');reject.onclick=()=>api('/api/discovery/leads/'+item.id+'/reject',{}).then(()=>card.remove()).catch(e=>show(e.message));card.append(draft,reject);}panel.append(card);}});
bind('save-plan',async()=>{el('plan-result').textContent=JSON.stringify(await api('/api/recruitment-plans',JSON.parse(el('plan-draft').value)),null,2);});bind('reload',reload);bind('enable',()=>api('/api/control',{enabled:true}).then(show));bind('disable',()=>api('/api/control',{enabled:false}).then(show));bind('refresh',()=>action('refresh'));bind('resume',()=>action('resume'));
bind('load',async()=>{el('proposal').value=JSON.stringify(await api('/api/configuration/'+el('existing').value),null,2);reviewedHash=null;activeDiscoveryLead=null;el('install').disabled=true;});
el('proposal').oninput=()=>{reviewedHash=null;el('install').disabled=true;};
bind('suggest',async()=>{const result=await api('/api/configuration/suggest',{proposal:JSON.parse(el('proposal').value),usePublicAi:true});el('proposal').value=JSON.stringify(result.proposal,null,2);reviewedHash=null;el('install').disabled=true;show({mode:result.mode,reason:result.reason,notice:result.notice});});
bind('preview',async()=>{reviewedBody=JSON.parse(el('proposal').value);const result=await api('/api/configuration/preview',reviewedBody);reviewedHash=result.proposalHash;el('review').textContent=JSON.stringify(result,null,2);el('install').disabled=false;});
el('enable-new-refresh').onchange=()=>{try{const proposal=JSON.parse(el('proposal').value);if(proposal.configuration.schemaVersion==='tenant-1.0.0')proposal.configuration.policy.crawlIntervalEnabled=el('enable-new-refresh').checked;else proposal.configuration.policy.crawlInterval.enabled=el('enable-new-refresh').checked;el('proposal').value=JSON.stringify(proposal,null,2);reviewedHash=null;el('install').disabled=true;}catch{show('请先载入或完成试采配置。');el('enable-new-refresh').checked=false;}};
bind('install',async()=>{if(!el('confirmed').checked||!reviewedHash)throw Error('请先核对预览并勾选确认');show(await api('/api/configuration/install',{proposal:reviewedBody,reviewedHash,confirmedScope:true,enableRefresh:el('enable-new-refresh').checked,...(activeDiscoveryLead?{discoveryLeadId:activeDiscoveryLead}:{})}));reviewedHash=null;activeDiscoveryLead=null;el('install').disabled=true;});reload().catch(e=>show(e.message));
</script></html>`;
}
