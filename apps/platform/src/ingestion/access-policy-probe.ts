import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "../lib/canonical-json.js";
import { listSourceKeys, loadSourceConfig, type SourceConfig } from "../sources/source-config.js";
import { fetchRobotsTxt, type RobotsFetchRecord } from "./robots-fetch.js";
import { evaluateRobotsForSource } from "./robots-policy.js";
import { shanghaiDateKey } from "../catalog/effective-activity.js";

/**
 * ADR-0033 的**首次取证**通路。`decideAccessPolicyRecheck` 早就写好了，但它在
 * `recordedEvidence === null` 时返回 pause，而 34 份配置的 `accessPolicyEvidence` 全部为 null，
 * 所以先接复核会让每个来源一到刷新就被暂停。顺序必须是先取证、再接复核。
 *
 * 本命令**只产出证据草稿，不写配置**。原因是 `accessPolicyEvidence` 有两半：
 *
 * - `robots` 半边可以机器取回并判定，就是这里做的事；
 * - `termsOfService` 半边要人读条款页、摘录原句、判断有没有禁止聚合的条款。这半边不能自动生成，
 *   否则就是让模型替人做合规判断。
 *
 * 因此输出是一份可粘贴的 `robots` 子对象加逐来源判定。人补上 `termsOfService` 与 `evidenceRef`
 * 后再把 `accessPolicyAccepted` 翻成 `pass`——`enforceAccessPolicyEvidence` 会保证证据不全时
 * 那个门根本设不上 `pass`，所以这里不写配置不会留下半成品。
 */

export interface AccessPolicyProbeRuntime {
  appEnv: "local" | "test" | "alpha" | "production";
  enableSourceProbe: boolean;
  workspaceRoot: string;
  /** 同一轮内两次主机请求之间的最小间隔。 */
  requestIntervalMs: number;
}

/** 与 `AccessPolicyEvidence["robots"]` 同形，供人工直接粘贴进配置。 */
export type RobotsEvidenceDraft =
  | {
      status: "fetched";
      bodySha256: string;
      allowsAllFetchTargets: boolean;
      crawlDelaySeconds: number | null;
    }
  | { status: "unavailable"; reason: "not_found" | "timeout" | "http_error" | "network_error" };

export interface AccessPolicySourceReport {
  sourceKey: string;
  /** 该来源已登记 fetchTargets 涉及的全部主机。多主机来源必须每个主机都允许。 */
  hosts: string[];
  /** 可直接粘贴进 `policy.accessPolicyEvidence.robots` 的草稿。 */
  robots: RobotsEvidenceDraft;
  /** 判定为允许时为 null；否则给出原因码与被禁的路径。 */
  denyCode: string | null;
  blockedHost: string | null;
  blockedPathPrefix: string | null;
  matchedRule: string | null;
  /** 已登记 fetchTargets 的路径条数，便于确认判定覆盖了全部获准范围。 */
  fetchTargetCount: number;
  /** 人工仍需补齐的部分。 */
  pendingHumanReview: string[];
}

export interface AccessPolicyHostReport {
  host: string;
  requestUrl: string;
  status: "fetched" | "unavailable";
  reason: string | null;
  errorCode: string | null;
  /** 服务端声明的 content-type；只作留证，判定按内容而非 MIME。 */
  contentType: string | null;
  /** 失败详情，例如被拒跳转的 Location。 */
  detail: string | null;
  bodySha256: string | null;
  /** 快照落盘路径（相对 workspaceRoot）；取回失败时为 null。 */
  snapshotPath: string | null;
  /** 引用该主机的来源键。 */
  sourceKeys: string[];
}

export interface AccessPolicyProbeResult {
  verifiedAt: string;
  requestCount: number;
  hosts: AccessPolicyHostReport[];
  sources: AccessPolicySourceReport[];
}

const SNAPSHOT_DIRECTORY = join(".data", "access-policy");

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function hostsOf(config: SourceConfig): string[] {
  return [...new Set(config.policy.fetchTargets.map((target) => target.host.toLowerCase()))].sort();
}

/**
 * 多主机来源：任一主机的 robots 取不到或禁止，整个来源就不通过（与
 * `evaluateRobotsForSource` 对多 target 的处理同构——判定对象是「已登记的访问范围」整体）。
 * 因此这里按主机逐个判定后取最严的那一个作为该来源的结论。
 */
function reportForSource(
  config: SourceConfig,
  records: ReadonlyMap<string, RobotsFetchRecord>,
): AccessPolicySourceReport {
  const hosts = hostsOf(config);
  const pendingHumanReview = [
    "termsOfService.documentUrl",
    "termsOfService.excerpt",
    "termsOfService.prohibitsAggregation",
    "evidenceRef",
  ];
  const base = {
    sourceKey: config.sourceKey,
    hosts,
    fetchTargetCount: config.policy.fetchTargets.length,
    pendingHumanReview,
  };

  let strictestDelay: number | null = null;
  const fetchedShas: string[] = [];
  for (const host of hosts) {
    const record = records.get(host);
    if (!record) {
      return {
        ...base,
        robots: { status: "unavailable", reason: "network_error" },
        denyCode: "ROBOTS_NOT_FETCHED",
        blockedHost: host,
        blockedPathPrefix: null,
        matchedRule: null,
      };
    }
    if (record.outcome.status === "unavailable") {
      return {
        ...base,
        robots: { status: "unavailable", reason: record.outcome.reason },
        denyCode: "ROBOTS_UNAVAILABLE",
        blockedHost: host,
        blockedPathPrefix: null,
        matchedRule: null,
      };
    }
    // 只用属于该主机的 target 判定，避免拿 A 主机的 robots 去判 B 主机的路径。
    const hostTargets = config.policy.fetchTargets.filter(
      (target) => target.host.toLowerCase() === host,
    );
    const verdict = evaluateRobotsForSource(record.outcome, hostTargets);
    if (!verdict.allowed) {
      return {
        ...base,
        robots: {
          status: "fetched",
          bodySha256: sha256(record.outcome.body),
          allowsAllFetchTargets: false,
          crawlDelaySeconds: verdict.crawlDelaySeconds ?? null,
        },
        denyCode: verdict.code,
        blockedHost: host,
        blockedPathPrefix: verdict.blockedPathPrefix,
        matchedRule: verdict.matchedRule,
      };
    }
    if (verdict.crawlDelaySeconds !== undefined) {
      strictestDelay = Math.max(strictestDelay ?? 0, verdict.crawlDelaySeconds);
    }
    fetchedShas.push(sha256(record.outcome.body));
  }

  const singleHost = hosts.length === 1;
  return {
    ...base,
    robots: {
      status: "fetched",
      // 单主机来源直接留该主机 robots 的哈希；多主机来源留各主机哈希拼接后的哈希，
      // 任一主机 robots 变化都会改变它，与 `decideAccessPolicyRecheck` 的变化检测一致。
      bodySha256: singleHost ? (fetchedShas[0] as string) : sha256(fetchedShas.join("\n")),
      allowsAllFetchTargets: true,
      crawlDelaySeconds: strictestDelay,
    },
    denyCode: null,
    blockedHost: null,
    blockedPathPrefix: null,
    matchedRule: null,
  };
}

export interface AccessPolicyProbeDependencies {
  listSourceKeys: typeof listSourceKeys;
  loadSourceConfig: typeof loadSourceConfig;
  fetchRobotsTxt: typeof fetchRobotsTxt;
}

const defaultDependencies: AccessPolicyProbeDependencies = {
  listSourceKeys,
  loadSourceConfig,
  fetchRobotsTxt,
};

export async function runAccessPolicyProbe(input: {
  runtime: AccessPolicyProbeRuntime;
  /** 省略即处理 `config/sources` 全部来源。 */
  sourceKeys?: readonly string[];
  liveProbeApproved: boolean;
  now?: Date;
  dependencies?: Partial<AccessPolicyProbeDependencies>;
}): Promise<AccessPolicyProbeResult> {
  // 与 `runSourceProbe` 同一条边界：只在本机且显式开启探测时可跑，CI 与 Alpha/Production 一律拒绝。
  if (input.runtime.appEnv !== "local" || !input.runtime.enableSourceProbe) {
    throw new Error("ACCESS_POLICY_PROBE_LOCAL_ONLY");
  }
  if (!input.liveProbeApproved) {
    throw new Error("ACCESS_POLICY_PROBE_LIVE_CONFIRMATION_REQUIRED");
  }
  const deps = { ...defaultDependencies, ...input.dependencies };
  const sourceKeys = input.sourceKeys ?? (await deps.listSourceKeys());
  if (sourceKeys.length === 0) throw new Error("ACCESS_POLICY_PROBE_NO_SOURCES");

  const configs = await Promise.all(sourceKeys.map((key) => deps.loadSourceConfig(key)));

  // 按主机去重后再取：多个来源共用一个主机（如同一所高校就业网下的多家企业）时，
  // 一轮只该打一次请求。这既是礼貌，也让「一次取证 = 每主机一次请求」这句话字面成立。
  const hostToSources = new Map<string, string[]>();
  for (const config of configs) {
    for (const host of hostsOf(config)) {
      hostToSources.set(host, [...(hostToSources.get(host) ?? []), config.sourceKey]);
    }
  }
  const hosts = [...hostToSources.keys()].sort();

  const snapshotDirectory = join(input.runtime.workspaceRoot, SNAPSHOT_DIRECTORY);
  await mkdir(snapshotDirectory, { recursive: true });

  const records = new Map<string, RobotsFetchRecord>();
  const hostReports: AccessPolicyHostReport[] = [];
  let requestCount = 0;

  for (const [index, host] of hosts.entries()) {
    if (index > 0) await delay(input.runtime.requestIntervalMs);
    const record = await deps.fetchRobotsTxt({ host });
    requestCount += 1;
    records.set(host, record);

    let snapshotPath: string | null = null;
    let bodySha256: string | null = null;
    if (record.outcome.status === "fetched") {
      bodySha256 = sha256(record.outcome.body);
      // 原文落盘供人工复核：ADR-0033 要求证据本身可复核，只留哈希无法回答「当时写的是什么」。
      // `.data/` 已被 Git 忽略，不会提交。
      const fileName = `${host}-${bodySha256.slice(0, 12)}.txt`;
      await writeFile(join(snapshotDirectory, fileName), record.outcome.body, "utf8");
      snapshotPath = join(SNAPSHOT_DIRECTORY, fileName);
    }

    hostReports.push({
      host,
      requestUrl: record.requestUrl,
      status: record.outcome.status,
      reason: record.outcome.status === "unavailable" ? record.outcome.reason : null,
      errorCode: record.errorCode,
      contentType: record.contentType ?? null,
      detail: record.detail ?? null,
      bodySha256,
      snapshotPath,
      sourceKeys: [...(hostToSources.get(host) ?? [])].sort(),
    });
  }

  return {
    verifiedAt: shanghaiDateKey(input.now ?? new Date()),
    requestCount,
    hosts: hostReports,
    sources: configs
      .map((config) => reportForSource(config, records))
      .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey)),
  };
}
