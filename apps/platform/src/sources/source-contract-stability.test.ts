import { describe, expect, it } from "vitest";
import {
  type ContractStabilityObservation,
  type ContractStabilityVerdict,
  evaluateContractStability,
  evaluateSourcePersistence,
} from "./source-contract-stability.js";

const hours = (count: number) => count * 3_600_000;
const base = Date.parse("2026-08-01T02:00:00+08:00");

function observation(
  offsetHours: number,
  overrides: Partial<ContractStabilityObservation> = {},
): ContractStabilityObservation {
  return {
    finishedAt: new Date(base + hours(offsetHours)),
    policyVersion: 3,
    adapterVersion: "1.2.0",
    accepted: true,
    ...overrides,
  };
}

/**
 * ADR-0035 第三条：判据是**观察次数与跨度**，不是在线时长。这些用例的共同点是「机器关机只延后
 * 达标时间，不产生惩罚」——没有任何一条断言依赖运行是否连续。
 */
describe("source contract stability", () => {
  it("passes on three accepted refreshes spaced at least twenty hours apart", () => {
    const verdict = evaluateContractStability([
      observation(0),
      observation(24),
      observation(48),
    ]);

    expect(verdict).toMatchObject({
      status: "pass",
      acceptedRunCount: 3,
      qualifyingRunCount: 3,
      observationSpanHours: 48,
      shortfalls: [],
    });
  });

  it("stays pending with a precise shortfall instead of failing when evidence is thin", () => {
    expect(evaluateContractStability([observation(0)])).toMatchObject({
      status: "pending",
      qualifyingRunCount: 1,
      observationSpanHours: null,
      shortfalls: ["needs_2_more_qualifying_refreshes"],
    });
    expect(evaluateContractStability([])).toMatchObject({
      status: "pending",
      acceptedRunCount: 0,
      shortfalls: ["needs_3_more_qualifying_refreshes"],
    });
  });

  // 三次挤在同一天不构成「分散观察」。20 小时而不是 24 小时是为了给调度抖动留余量——若门槛与
  // 普遍的 24h `crawl_interval` 相等，差几分钟就不计数，永远攒不满。
  it("does not count refreshes bunched inside the same day", () => {
    expect(
      evaluateContractStability([observation(0), observation(2), observation(6)]),
    ).toMatchObject({ status: "pending", acceptedRunCount: 3, qualifyingRunCount: 1 });
    expect(
      evaluateContractStability([observation(0), observation(19.5), observation(40)]),
    ).toMatchObject({ qualifyingRunCount: 2 });
  });

  // 贪心取点：同小时重放与补跑会产生密集运行，若要求每一对相邻运行都满足间隔，一次重放就能让
  // 整段证据作废。多跑不该受罚。
  it("keeps qualifying refreshes when extra replays land in between", () => {
    const verdict = evaluateContractStability([
      observation(0),
      observation(0.5),
      observation(24),
      observation(24.2),
      observation(25),
      observation(48),
    ]);

    expect(verdict).toMatchObject({
      status: "pass",
      acceptedRunCount: 6,
      qualifyingRunCount: 3,
      observationSpanHours: 48,
    });
  });

  // `automation_acceptance = 'accepted'` 已经要求 completion 不是 failed、无硬冲突码、无数量异常，
  // 因此它就是机器对「冻结契约仍解析得通」的判断，不需要另造一套结构比较。
  it("ignores runs the automation did not accept", () => {
    const verdict = evaluateContractStability([
      observation(0),
      observation(24, { accepted: false }),
      observation(48),
    ]);

    expect(verdict).toMatchObject({
      status: "pending",
      acceptedRunCount: 2,
      qualifyingRunCount: 2,
      shortfalls: ["needs_1_more_qualifying_refreshes"],
    });
  });

  // 稳定性是关于**当前**契约的断言：适配器或政策改过之后，改动之前的成功刷新不能再用来证明
  // 「现在这套契约稳定」。代价是任何适配器改动都会清零，重新攒满约两天——按 fail-closed 取这侧。
  it("resets the count when the adapter or policy version changes", () => {
    expect(
      evaluateContractStability([
        observation(0),
        observation(24),
        observation(48, { adapterVersion: "1.3.0" }),
      ]),
    ).toMatchObject({ status: "pending", acceptedRunCount: 1, qualifyingRunCount: 1 });
    expect(
      evaluateContractStability([
        observation(0),
        observation(24),
        observation(48, { policyVersion: 4 }),
      ]),
    ).toMatchObject({ status: "pending", acceptedRunCount: 1 });
  });
});

function verdict(
  qualifyingRunCount: number,
  observationSpanHours: number | null,
): ContractStabilityVerdict {
  return {
    status: qualifyingRunCount >= 3 ? "pass" : "pending",
    acceptedRunCount: qualifyingRunCount,
    qualifyingRunCount,
    observationSpanHours,
    shortfalls: [],
  };
}

/**
 * 替代的是「3 个来源连续 7 天按 12 小时周期运行」。跨度用首末合格刷新之间的实际间隔计量，
 * 中途关机只是把达标日期往后推。
 */
describe("source persistence", () => {
  it("passes once three sources each hold three refreshes across three days", () => {
    expect(
      evaluateSourcePersistence(
        new Map([
          ["alpha-source", verdict(3, 72)],
          ["beta-source", verdict(4, 96)],
          ["gamma-source", verdict(3, 73)],
        ]),
      ),
    ).toMatchObject({
      status: "pass",
      persistentSourceCount: 3,
      persistentSourceKeys: ["alpha-source", "beta-source", "gamma-source"],
      shortfalls: [],
    });
  });

  it("excludes sources that have the count but not the span, and reports the gap", () => {
    expect(
      evaluateSourcePersistence(
        new Map([
          ["alpha-source", verdict(3, 72)],
          // 次数够但全挤在两天内：跨度不足，不计入持续性。
          ["beta-source", verdict(3, 47)],
          ["gamma-source", verdict(2, 24)],
        ]),
      ),
    ).toMatchObject({
      status: "pending",
      persistentSourceCount: 1,
      persistentSourceKeys: ["alpha-source"],
      shortfalls: ["needs_2_more_persistent_sources"],
    });
  });
});
