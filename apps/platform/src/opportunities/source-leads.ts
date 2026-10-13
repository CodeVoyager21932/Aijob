import { z } from "zod";
import type { Database } from "@aijob/database";
import { type Kysely, sql } from "kysely";
import { normalizeLeadUrl } from "./discovery.js";

export const LeadDraftRequestSchema = z
  .object({
    sourceKey: z.string().regex(/^[a-z0-9-]{3,80}$/),
    companyName: z.string().trim().min(1).max(200),
    officialUrl: z.string().url(),
  })
  .strict();
const forbidden = [
  "zhipin.com",
  "shixiseng.com",
  "nowcoder.com",
  "51job.com",
  "zhaopin.com",
  "liepin.com",
  "lagou.com",
];
export function buildLeadProposal(
  input: z.infer<typeof LeadDraftRequestSchema>,
  evidenceUrl: string,
) {
  const url = normalizeLeadUrl(input.officialUrl);
  if (!url) throw new Error("DISCOVERY_OFFICIAL_URL_REQUIRED");
  const u = new URL(url);
  if (forbidden.some((host) => u.hostname === host || u.hostname.endsWith(`.${host}`)))
    throw new Error("DISCOVERY_PLATFORM_NOT_A_SOURCE");
  const gate = { status: "pending", note: "待运营核验；搜索结果不构成主体、政策或稳定性证据。" };
  const scores = Object.fromEntries(
    ["targetSupply", "policyAccess", "structure", "freshnessMaintenance", "diversity"].map((k) => [
      k,
      { weight: 20, score: 0, status: "pending", note: "待实际核验。" },
    ]),
  );
  const options = {
    configurationVersion: "1.0.0",
    render: false,
    list: {
      row: "[data-aijob-unconfigured-row]",
      detailLink: "a",
      nextLink: null,
      terminalMarker: "[data-aijob-unconfigured-terminal]",
      emptyMarker: null,
    },
    detail: {
      title: "h1",
      responsibilities: null,
      requirements: "[data-aijob-unconfigured-requirements]",
      applyLink: null,
    },
  };
  const target = {
    method: "GET",
    scheme: "https",
    host: u.hostname,
    port: 443,
    pathPrefix: u.pathname,
    allowRedirects: false,
    allowedQueryParameters: [...new Set(u.searchParams.keys())],
  };
  return {
    configuration: {
      schemaVersion: "1.0.0",
      sourceKey: input.sourceKey,
      sourceType: "organization_career_site",
      catalogRole: "discovery_only",
      runtimeScope: "local",
      organization: { slug: input.sourceKey, name: input.companyName, officialDomain: u.hostname },
      candidate: {
        name: input.companyName,
        entrypointUrl: url,
        provenanceLevel: "unverified",
        acquisitionMode: "deterministic_html",
        candidateStatus: "candidate",
        assessor: "discovery-draft-unverified",
        hardGates: {
          officialIdentity: gate,
          targetSupply: gate,
          noAuthBypass: gate,
          officialApplyLink: gate,
          accessPolicyAccepted: gate,
          stableIdentityAndFields: gate,
        },
        scores,
        evidenceNotes: [`发现线索：${evidenceUrl}。仅作为核验起点，尚未访问或验证官网。`],
      },
      policy: {
        version: "1",
        status: "pending_review",
        adapterKey: "configured-official-html",
        adapterVersion: "1.0.0",
        adapterOptions: options,
        entrypoints: [url],
        crawlInterval: { enabled: false, minimumHours: 24 },
        refreshCoverage: "full_scope",
        absencePolicy: "close_after_two_complete_absences",
        reviewedAt: new Date().toISOString().slice(0, 10),
        policyNotes: [
          "草案未核验，不代表准入。需确认主体、公开政策、精确请求范围、解析样本和采集方式，再显式启用。",
        ],
        accessPolicyEvidence: null,
        fetchTargets: [target],
        applyTargets: [target],
      },
      localProbe: {
        enabled: false,
        environment: "local",
        requestBudget: { maxItems: 100, maxPages: 5, maxRequests: 110, minimumIntervalMs: 2000 },
        completion: "partial",
        requestDefaults: options,
        queryStreams: [
          {
            key: "all",
            label: "官方在校生岗位",
            keyword: "",
            positionFamilyIds: [],
            targetItems: 100,
          },
        ],
      },
    },
    expectedPreviousHash: null,
  };
}
export async function listDiscoveryLeads(db: Kysely<Database>) {
  return {
    items: (
      await sql`SELECT id,canonical_url,hostname,title,status,source_key,first_seen_at,last_seen_at FROM source_control.discovery_leads ORDER BY first_seen_at DESC LIMIT 100`.execute(
        db,
      )
    ).rows,
  };
}
export async function draftDiscoveryLead(
  db: Kysely<Database>,
  id: string,
  request: z.infer<typeof LeadDraftRequestSchema>,
) {
  return db.transaction().execute(async (tx) => {
    const lead = (
      await sql<{
        canonical_url: string;
        status: string;
      }>`SELECT canonical_url,status FROM source_control.discovery_leads WHERE id=${id}::uuid FOR UPDATE`.execute(
        tx,
      )
    ).rows[0];
    if (!lead || lead.status === "configured") throw new Error("DISCOVERY_LEAD_NOT_DRAFTABLE");
    const proposal = buildLeadProposal(request, lead.canonical_url);
    await sql`UPDATE source_control.discovery_leads SET status='draft',source_key=${request.sourceKey},proposal=${JSON.stringify(proposal)}::jsonb WHERE id=${id}::uuid`.execute(
      tx,
    );
    return {
      proposal,
      notice:
        "已生成禁用草案。填写实际样本、提取配置和准入证据，再使用下方已有预览与安装。未知项没有代填为通过。",
    };
  });
}
