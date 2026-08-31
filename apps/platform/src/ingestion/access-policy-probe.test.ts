import { describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "../lib/canonical-json.js";
import type { SourceConfig } from "../sources/source-config.js";
import {
  type AccessPolicyProbeRuntime,
  runAccessPolicyProbe,
} from "./access-policy-probe.js";
import { robotsUnavailableReason, type RobotsFetchRecord } from "./robots-fetch.js";

/**
 * 零触网：`fetchRobotsTxt` 全部打桩。真实取回只有 `pnpm source:access-policy-probe --confirm-live`
 * 会做，且被 `appEnv=local` 与 `enableSourceProbe` 两道条件挡住。
 */
async function runtime(): Promise<AccessPolicyProbeRuntime> {
  return {
    appEnv: "local",
    enableSourceProbe: true,
    workspaceRoot: await mkdtemp(join(tmpdir(), "aijob-access-policy-")),
    requestIntervalMs: 0,
  };
}

function target(host: string, pathPrefix: string, method: "GET" | "POST" = "GET") {
  return {
    method,
    scheme: "https" as const,
    host,
    port: 443 as const,
    pathPrefix,
    allowRedirects: false,
    allowedQueryParameters: [] as string[],
  };
}

function config(
  sourceKey: string,
  fetchTargets: ReturnType<typeof target>[],
): SourceConfig {
  return { sourceKey, policy: { fetchTargets } } as unknown as SourceConfig;
}

function fetched(host: string, body: string): RobotsFetchRecord {
  return { host, requestUrl: `https://${host}/robots.txt`, outcome: { status: "fetched", body }, errorCode: null };
}

function unavailable(host: string, errorCode: string): RobotsFetchRecord {
  return {
    host,
    requestUrl: `https://${host}/robots.txt`,
    outcome: { status: "unavailable", reason: robotsUnavailableReason(errorCode) },
    errorCode,
  };
}

function probe(input: {
  configs: SourceConfig[];
  records: Record<string, RobotsFetchRecord>;
  runtime: AccessPolicyProbeRuntime;
  requestedHosts?: string[];
}) {
  return runAccessPolicyProbe({
    runtime: input.runtime,
    liveProbeApproved: true,
    now: new Date("2026-08-29T10:00:00+08:00"),
    dependencies: {
      listSourceKeys: async () => input.configs.map((entry) => entry.sourceKey),
      loadSourceConfig: async (sourceKey: string) => {
        const found = input.configs.find((entry) => entry.sourceKey === sourceKey);
        if (!found) throw new Error("SOURCE_CONFIG_NOT_FOUND");
        return found;
      },
      fetchRobotsTxt: async ({ host }: { host: string }) => {
        input.requestedHosts?.push(host);
        const record = input.records[host];
        if (!record) throw new Error(`UNEXPECTED_HOST_${host}`);
        return record;
      },
    },
  });
}

describe("access policy first-evidence probe (ADR-0033)", () => {
  it("refuses to run outside a local, probe-enabled, explicitly confirmed run", async () => {
    const local = await runtime();
    const base = { runtime: local, liveProbeApproved: true, sourceKeys: ["any"] };

    await expect(
      runAccessPolicyProbe({ ...base, runtime: { ...local, appEnv: "alpha" } }),
    ).rejects.toThrow("ACCESS_POLICY_PROBE_LOCAL_ONLY");
    await expect(
      runAccessPolicyProbe({ ...base, runtime: { ...local, enableSourceProbe: false } }),
    ).rejects.toThrow("ACCESS_POLICY_PROBE_LOCAL_ONLY");
    await expect(
      runAccessPolicyProbe({ ...base, liveProbeApproved: false }),
    ).rejects.toThrow("ACCESS_POLICY_PROBE_LIVE_CONFIRMATION_REQUIRED");
  });

  it("produces a pasteable robots draft and leaves the terms half to a human", async () => {
    const body = "User-agent: *\nAllow: /\nCrawl-delay: 3\n";
    const local = await runtime();
    const result = await probe({
      runtime: local,
      configs: [config("adaps", [target("adaps-ph.zhiye.com", "/api/job/list", "POST")])],
      records: { "adaps-ph.zhiye.com": fetched("adaps-ph.zhiye.com", body) },
    });

    expect(result.verifiedAt).toBe("2026-08-29");
    expect(result.requestCount).toBe(1);
    expect(result.sources[0]).toMatchObject({
      sourceKey: "adaps",
      hosts: ["adaps-ph.zhiye.com"],
      robots: {
        status: "fetched",
        bodySha256: sha256(body),
        allowsAllFetchTargets: true,
        crawlDelaySeconds: 3,
      },
      denyCode: null,
      fetchTargetCount: 1,
    });
    // 条款那半边不能自动生成，否则等于让机器替人做合规判断。
    expect(result.sources[0]?.pendingHumanReview).toEqual([
      "termsOfService.documentUrl",
      "termsOfService.excerpt",
      "termsOfService.prohibitsAggregation",
      "evidenceRef",
    ]);
  });

  // ADR-0033 的 fail-closed 规则：取不到 robots 一律视为禁止。「技术上取不到」不等于「站点允许」。
  it("records every unavailable robots as prohibited, keeping the reason distinguishable", async () => {
    const local = await runtime();
    const cases: Array<[string, string]> = [
      ["UPSTREAM_HTTP_404", "not_found"],
      ["UPSTREAM_TIMEOUT", "timeout"],
      ["UPSTREAM_HTTP_503", "http_error"],
      // 站点把 /robots.txt 回成 HTML 通常是 SPA 兜底路由，即软 404，不能当「没有 robots 因此允许」。
      ["ROBOTS_RESPONSE_IS_MARKUP", "http_error"],
      ["REDIRECT_NOT_ALLOWED", "http_error"],
      ["DNS_EMPTY", "network_error"],
    ];
    for (const [errorCode, reason] of cases) {
      const result = await probe({
        runtime: local,
        configs: [config("cuhk", [target("career.cuhk.edu.cn", "/jobview/")])],
        records: { "career.cuhk.edu.cn": unavailable("career.cuhk.edu.cn", errorCode) },
      });
      expect(result.sources[0], errorCode).toMatchObject({
        robots: { status: "unavailable", reason },
        denyCode: "ROBOTS_UNAVAILABLE",
        blockedHost: "career.cuhk.edu.cn",
      });
      expect(result.hosts[0], errorCode).toMatchObject({ errorCode, snapshotPath: null });
    }
  });

  // 多个来源共用一个主机是常态（同一所高校就业网下的多家企业），一轮只该打一次请求。
  // 这既是礼貌，也让「一次取证 = 每主机一次请求」这句话字面成立。
  it("fetches each host once even when several sources share it, and keeps the raw snapshot", async () => {
    const body = "User-agent: *\nDisallow:\n";
    const local = await runtime();
    const requestedHosts: string[] = [];
    const result = await probe({
      runtime: local,
      requestedHosts,
      configs: [
        config("nankai-a", [target("career.nankai.edu.cn", "/correcruit/content/")]),
        config("nankai-b", [target("career.nankai.edu.cn", "/correcruit/content/")]),
        config("zju", [target("www.career.zju.edu.cn", "/jyxt/")]),
      ],
      records: {
        "career.nankai.edu.cn": fetched("career.nankai.edu.cn", body),
        "www.career.zju.edu.cn": fetched("www.career.zju.edu.cn", body),
      },
    });

    expect(requestedHosts).toEqual(["career.nankai.edu.cn", "www.career.zju.edu.cn"]);
    expect(result.requestCount).toBe(2);
    expect(result.hosts[0]?.sourceKeys).toEqual(["nankai-a", "nankai-b"]);

    // ADR-0033 要求证据本身可复核：只留哈希无法回答「当时写的是什么」，因此原文落盘。
    const snapshotPath = result.hosts[0]?.snapshotPath;
    expect(snapshotPath).toBe(
      join(".data", "access-policy", `career.nankai.edu.cn-${sha256(body).slice(0, 12)}.txt`),
    );
    expect(await readFile(join(local.workspaceRoot, snapshotPath as string), "utf8")).toBe(body);
    expect(await readdir(join(local.workspaceRoot, ".data", "access-policy"))).toHaveLength(2);
  });

  it("names the disallowed target when robots forbids part of the registered scope", async () => {
    const local = await runtime();
    const result = await probe({
      runtime: local,
      configs: [
        config("meituan", [
          target("zhaopin.meituan.com", "/web/position/list", "POST"),
          target("zhaopin.meituan.com", "/web/position/detail", "POST"),
        ]),
      ],
      records: {
        "zhaopin.meituan.com": fetched(
          "zhaopin.meituan.com",
          "User-agent: *\nDisallow: /web/position/detail\n",
        ),
      },
    });

    expect(result.sources[0]).toMatchObject({
      robots: { status: "fetched", allowsAllFetchTargets: false },
      denyCode: "ROBOTS_DISALLOWED",
      blockedPathPrefix: "/web/position/detail",
      matchedRule: "/web/position/detail",
      fetchTargetCount: 2,
    });
  });
});
