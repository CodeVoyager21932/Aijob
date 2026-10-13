import { setTimeout as pause } from "node:timers/promises";
import { z } from "zod";
import { shanghaiDateKey } from "../catalog/effective-activity.js";
import { fetchRobotsTxt } from "../ingestion/robots-fetch.js";
import { evaluateRobotsPath } from "../ingestion/robots-policy.js";
import { safeRequestHtml, safeRequestJson } from "../ingestion/safe-http.js";
import { sha256 } from "../lib/canonical-json.js";
import { buildLeadProposal, LeadDraftRequestSchema } from "../opportunities/source-leads.js";
import {
  BEISEN_ZHIYE_ADAPTER_VERSION,
  type BeisenJobAd,
  type BeisenZhiyeTenant,
  buildBeisenZhiyeListRequest,
  normalizeBeisenZhiyeJobAd,
  parseBeisenZhiyeListPage,
} from "./beisen-zhiye-adapter.js";
import type { ConfigurationProposal } from "./onboarding-service.js";
import { parseSourceConfigValue, type SourceTarget } from "./source-config.js";

export const TenantOnboardingRequestSchema = LeadDraftRequestSchema.extend({
  category: z.enum(["2", "3"]).default("3"),
  officialEvidenceUrl: z.string().url(),
  termsUrl: z.string().url().nullable(),
  termsExcerpt: z.string().trim().min(1).max(5000),
  confirmedPublicScope: z.literal(true),
}).strict();
export type TenantOnboardingRequest = z.infer<typeof TenantOnboardingRequestSchema>;
export const TENANT_ONBOARDING_VERSION = "beisen-portal-v1";
/** Read JSON embedded by the portal. Never execute its JavaScript or follow asset URLs. */
export function identifyBeisenPortal(html: string, host: string) {
  if (!/^[a-z0-9-]+\.zhiye\.com$/i.test(host)) throw new Error("SOURCE_VENDOR_UNRECOGNIZED");
  const match = /(?:var|let|const)\s+BSGlobal\s*=\s*(\{)/.exec(html);
  if (!match) throw new Error("BEISEN_PORTAL_VARIANT_UNRECOGNIZED");
  const start = match.index + match[0].length - 1;
  let depth = 0,
    string = false,
    escaped = false,
    end = -1;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (string) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') string = false;
      continue;
    }
    if (char === '"') string = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  if (end < 0) throw new Error("BEISEN_PORTAL_DATA_INCOMPLETE");
  const data = z
    .object({
      PortalId: z.string().uuid(),
      Pages: z.array(
        z.object({ Code: z.string(), PageType: z.number(), BusinessType: z.string().nullable() }),
      ),
    })
    .parse(JSON.parse(html.slice(start, end)));
  const categories = data.Pages.filter(
    (page) =>
      page.PageType === 2 &&
      ((page.BusinessType === "3" && page.Code === "InternList") ||
        (page.BusinessType === "2" && page.Code === "CampusList")),
  ).map((page) => ({
    category: page.BusinessType as "2" | "3",
    path: page.BusinessType === "3" ? ("/intern/jobs" as const) : ("/campus/jobs" as const),
  }));
  if (!categories.length) throw new Error("BEISEN_CATEGORY_NOT_EXPOSED");
  return { portalId: data.PortalId, categories };
}
export interface TenantProbeResult {
  state: "complete" | "explicit_empty" | "partial" | "failed";
  reason: string | null;
  requestCount: number;
  reportedTotal: number | null;
  parsedCount: number;
  vendor: string | null;
  portalId: string | null;
  categories: { category: string; path: string }[];
  preview: {
    id: string;
    title: string;
    locations: string[];
    responsibilities: string;
    requirements: string;
    applyUrl: string;
  }[];
  proposal: ConfigurationProposal | null;
}
export async function probeTenant(input: {
  request: TenantOnboardingRequest;
  runId: string;
  signal?: AbortSignal | undefined;
  dependencies?: {
    html?: typeof safeRequestHtml;
    json?: typeof safeRequestJson;
    robots?: typeof fetchRobotsTxt;
    wait?: (ms: number) => Promise<void>;
  };
}): Promise<TenantProbeResult> {
  const request = TenantOnboardingRequestSchema.parse(input.request);
  const draft = buildLeadProposal(request, request.officialEvidenceUrl),
    url = new URL(request.officialUrl);
  const target = (path: string, method: "GET" | "POST" = "GET"): SourceTarget => ({
    method,
    scheme: "https",
    host: url.hostname,
    port: 443,
    pathPrefix: path,
    allowRedirects: false,
    allowedQueryParameters: [],
  });
  const result: TenantProbeResult = {
    state: "failed",
    reason: null,
    requestCount: 0,
    reportedTotal: null,
    parsedCount: 0,
    vendor: null,
    portalId: null,
    categories: [],
    preview: [],
    proposal: null,
  };
  const wait = input.dependencies?.wait ?? ((ms) => pause(ms, undefined, { signal: input.signal }));
  let last = 0,
    interval = 2000;
  const beforeRequest = async () => {
    if (input.signal?.aborted) throw new Error("SOURCE_PROBE_CANCELLED");
    if (result.requestCount >= 24) throw new Error("SOURCE_PROBE_REQUEST_BUDGET");
    const ms = interval - (Date.now() - last);
    if (ms > 0) await wait(ms);
    result.requestCount++;
    last = Date.now();
  };
  try {
    const robots = await (input.dependencies?.robots ?? fetchRobotsTxt)({
      host: url.hostname,
      beforeRequest,
    });
    for (const path of [url.pathname, "/api/Jobad/GetJobAdPageList"]) {
      const decision = evaluateRobotsPath(robots.outcome, path);
      if (!decision.allowed) throw new Error(decision.code);
      interval = Math.max(interval, (decision.crawlDelaySeconds ?? 0) * 1000);
    }
    const html = await (input.dependencies?.html ?? safeRequestHtml)(
      { method: "GET", url: url.toString() },
      [target(url.pathname)],
      { beforeRequest },
    );
    const found = identifyBeisenPortal(html.text, url.hostname);
    result.vendor = "beisen-zhiye";
    result.portalId = found.portalId;
    result.categories = found.categories;
    const selected = found.categories.find((c) => c.category === request.category);
    if (!selected) throw new Error("BEISEN_REQUESTED_CATEGORY_NOT_EXPOSED");
    const selectedPolicy = evaluateRobotsPath(robots.outcome, selected.path);
    if (!selectedPolicy.allowed) throw new Error(selectedPolicy.code);
    if (url.pathname !== selected.path)
      await (input.dependencies?.html ?? safeRequestHtml)(
        { method: "GET", url: `${url.origin}${selected.path}` },
        [target(selected.path)],
        { beforeRequest },
      );
    const tenant: BeisenZhiyeTenant = {
      sourceKey: request.sourceKey,
      companyName: request.companyName,
      host: url.hostname,
      portalId: found.portalId,
      category: selected.category,
      categoryLabel: selected.category === "3" ? "实习" : "校园招聘",
      jobsPagePath: selected.path,
      reportedTotalKey: selected.category === "3" ? "intern-jobads" : "campus-jobads",
    };
    const jobs: BeisenJobAd[] = [],
      ids = new Set<number>();
    for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
      const response = await (input.dependencies?.json ?? safeRequestJson)(
        {
          method: "POST",
          url: `${url.origin}/api/Jobad/GetJobAdPageList`,
          jsonBody: buildBeisenZhiyeListRequest({ tenant, pageIndex, pageSize: 30 }),
        },
        [target("/api/Jobad/GetJobAdPageList", "POST")],
        { beforeRequest },
      );
      const parsed = parseBeisenZhiyeListPage(response.json);
      if (result.reportedTotal !== null && result.reportedTotal !== parsed.total)
        throw new Error("BEISEN_TOTAL_CHANGED_DURING_PROBE");
      result.reportedTotal = parsed.total;
      if (parsed.total === 0) {
        result.state = "explicit_empty";
        break;
      }
      if (!parsed.jobs.length) throw new Error("BEISEN_INCOMPLETE_PAGINATION");
      for (const job of parsed.jobs) {
        if (ids.has(job.JobAdId)) throw new Error("BEISEN_DUPLICATE_PAGE");
        if (!job.Duty.trim() && !job.Require.trim()) throw new Error("BEISEN_JOB_BODY_MISSING");
        ids.add(job.JobAdId);
        jobs.push(job);
      }
      result.parsedCount = jobs.length;
      if (jobs.length === parsed.total) {
        result.state = "complete";
        break;
      }
      if (jobs.length > parsed.total) throw new Error("BEISEN_LIST_COUNT_INCONSISTENT");
      result.state = "partial";
    }
    result.preview = jobs.slice(0, 6).map((job, index) => {
      const normalized = normalizeBeisenZhiyeJobAd({
        tenant,
        job,
        listItemIndex: index,
        pageEvidenceRef: `onboarding:${input.runId}`,
      });
      return {
        id: normalized.sourceJobId,
        title: normalized.title,
        locations: job.LocNames,
        responsibilities: normalized.responsibilities,
        requirements: normalized.requirements,
        applyUrl: normalized.applyUrl!,
      };
    });
    if (result.state === "partial") {
      result.reason = "BEISEN_PROBE_PAGE_BUDGET";
      return result;
    }
    const raw = draft.configuration;
    const options = {
      category: tenant.category,
      pageIndex: 0,
      pageSize: 30,
      portalId: found.portalId,
      jobsPagePath: tenant.jobsPagePath,
      companyDisplayName: request.companyName,
      categoryLabel: tenant.categoryLabel,
    };
    const evidenceRef = `onboarding:${input.runId}`;
    const gate = (note: string) => ({ status: "pass", note });
    const proposal = {
      configuration: {
        ...raw,
        sourceType: "official_ats",
        catalogRole: "canonical",
        organization: {
          ...raw.organization,
          officialDomain: new URL(request.officialEvidenceUrl).hostname,
        },
        candidate: {
          ...raw.candidate,
          provenanceLevel: "verified_ats_tenant",
          acquisitionMode: "public_api",
          candidateStatus: "local_probe_only",
          assessor: "local-maintainer-onboarding",
          hardGates: {
            ...raw.candidate.hardGates,
            officialIdentity: gate(`维护者确认企业官网关联：${request.officialEvidenceUrl}`),
            noAuthBypass: gate(`试采未使用登录、Cookie、验证码：${evidenceRef}`),
            officialApplyLink: gate(
              `官方职位列表提供投递，入口：${url.origin}${tenant.jobsPagePath}`,
            ),
            accessPolicyAccepted: gate(`robots实际核验；维护者提供条款原句：${evidenceRef}`),
          },
          evidenceNotes: [
            `主体关联由维护者核对：${request.officialEvidenceUrl}`,
            `实际试采 ${evidenceRef}：${result.state}，${jobs.length} 条；未作连续稳定性结论。`,
          ],
        },
        policy: {
          ...raw.policy,
          adapterKey: "beisen-zhiye-public-api",
          adapterVersion: BEISEN_ZHIYE_ADAPTER_VERSION,
          adapterOptions: options,
          entrypoints: [`${url.origin}${tenant.jobsPagePath}`],
          fetchTargets: [target("/api/Jobad/GetJobAdPageList", "POST")],
          applyTargets: [target(tenant.jobsPagePath)],
          accessPolicyEvidence: {
            robots: {
              status: "assessed",
              allowsAllFetchTargets: true,
              crawlDelaySeconds: interval / 1000,
              hosts: [
                {
                  host: url.hostname,
                  status: robots.outcome.status === "fetched" ? "fetched" : "missing",
                  bodySha256:
                    robots.outcome.status === "fetched" ? sha256(robots.outcome.body) : null,
                },
              ],
            },
            termsOfService: {
              documentUrl: request.termsUrl,
              excerpt: request.termsExcerpt,
              prohibitsAggregation: false,
            },
            verifiedAt: shanghaiDateKey(new Date()),
            evidenceRef,
          },
        },
        localProbe: {
          ...raw.localProbe,
          enabled: true,
          requestDefaults: options,
          requestBudget: {
            maxItems: 600,
            maxPages: 20,
            maxRequests: 24,
            minimumIntervalMs: interval,
          },
          queryStreams: [
            {
              key: tenant.reportedTotalKey,
              label: `${request.companyName}${tenant.categoryLabel}`,
              keyword: "",
              positionFamilyIds: [],
              targetItems: 600,
            },
          ],
        },
      },
      expectedPreviousHash: null,
    };
    parseSourceConfigValue(proposal.configuration);
    result.proposal = proposal;
    return result;
  } catch (error) {
    result.state = result.parsedCount > 0 ? "partial" : "failed";
    result.reason =
      error instanceof Error && /^[A-Z_]+$/.test(error.message)
        ? error.message
        : "SOURCE_PROBE_RESPONSE_UNRECOGNIZED";
    return result;
  }
}
