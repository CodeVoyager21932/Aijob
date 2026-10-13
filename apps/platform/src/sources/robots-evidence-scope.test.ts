import { readFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { parseSourceConfigValue } from "./source-config.js";

describe("access evidence matches the exact registered hosts", () => {
  async function fixture() {
    const config = JSON.parse(
      await readFile(
        new URL("../../../../config/sources/tencent-campus.json", import.meta.url),
        "utf8",
      ),
    );
    const hosts = [
      ...new Set<string>(config.policy.fetchTargets.map((target: { host: string }) => target.host)),
    ].map((host) => ({ host, status: "missing" as const, bodySha256: null }));
    return {
      ...config,
      candidate: {
        ...config.candidate,
        hardGates: {
          ...config.candidate.hardGates,
          accessPolicyAccepted: { status: "pass", note: "离线夹具中的显式核验" },
        },
      },
      policy: {
        ...config.policy,
        accessPolicyEvidence: {
          robots: {
            status: "assessed",
            allowsAllFetchTargets: true,
            crawlDelaySeconds: null,
            hosts,
          },
          termsOfService: {
            documentUrl: null,
            excerpt: "离线夹具：人工核对访问依据。",
            prohibitsAggregation: false,
          },
          verifiedAt: "2026-09-06",
          evidenceRef: "fixture-only",
        },
      },
    };
  }
  it("accepts missing robots evidence after explicit assessment, without approving the source", async () => {
    const input = await fixture(),
      parsed = parseSourceConfigValue(input);
    expect(parsed.policy.status).toBe("paused");
    expect(parsed.candidate.hardGates.accessPolicyAccepted).toBe("pass");
  });
  it("rejects stale, duplicate or unrelated host evidence before normalizing configurations", async () => {
    for (const mode of ["unrelated", "duplicate", "missing"]) {
      const input = await fixture(),
        hosts = input.policy.accessPolicyEvidence.robots.hosts;
      if (mode === "unrelated") hosts[0]!.host = "unrelated.example.test";
      if (mode === "duplicate") hosts.push({ ...hosts[0]! });
      if (mode === "missing") hosts.pop();
      expect(() => parseSourceConfigValue(input)).toThrow();
    }
  });
  it("does not invent hashes for missing files or omit hashes for fetched files", async () => {
    const input = await fixture();
    const host = input.policy.accessPolicyEvidence.robots.hosts[0]!;
    expect(() =>
      parseSourceConfigValue({
        ...input,
        policy: {
          ...input.policy,
          accessPolicyEvidence: {
            ...input.policy.accessPolicyEvidence,
            robots: {
              ...input.policy.accessPolicyEvidence.robots,
              hosts: [{ ...host, bodySha256: "a".repeat(64) }],
            },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      parseSourceConfigValue({
        ...input,
        policy: {
          ...input.policy,
          accessPolicyEvidence: {
            ...input.policy.accessPolicyEvidence,
            robots: {
              ...input.policy.accessPolicyEvidence.robots,
              hosts: [{ ...host, status: "fetched" }],
            },
          },
        },
      }),
    ).toThrow();
  });
});
