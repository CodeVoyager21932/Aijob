import { COLLECTOR_ROBOTS_TOKEN } from "./safe-http.js";

/**
 * ADR-0033 第一条：以站点公开 `robots.txt` 为访问政策依据。
 *
 * 本模块只做**解析与判定**，不发起网络请求——抓取 robots.txt 属于触网步骤，
 * 须由人工显式授权（ADR-0026）。因此这里接收已取回的文本或取回失败的原因，
 * 保证判定逻辑可用本地夹具完整测试。
 *
 * 关键的 fail-closed 规则：**取不到 robots.txt（缺失、超时、非 200）一律视为禁止。**
 * 「技术上取不到」不等于「站点允许」。
 */

export type RobotsFetchOutcome =
  | { status: "fetched"; body: string }
  | { status: "unavailable"; reason: "not_found" | "timeout" | "http_error" | "network_error" };

export interface RobotsGroup {
  /** 该组匹配的 User-agent token（小写）。 */
  agents: string[];
  /** `Disallow` 路径前缀，空字符串表示「不禁止任何路径」。 */
  disallow: string[];
  /** `Allow` 路径前缀。 */
  allow: string[];
  /** `Crawl-delay` 秒数；缺失或不可解析时为 undefined。 */
  crawlDelaySeconds: number | undefined;
}

export interface RobotsPolicy {
  /** 适用于本采集器的合并规则；没有任何匹配组时为 undefined。 */
  group: RobotsGroup | undefined;
  /** 是否存在 `User-agent: *` 或匹配本采集器 token 的组。 */
  hasApplicableGroup: boolean;
}

export type RobotsDecision =
  | { allowed: true; matchedRule: string | null; crawlDelaySeconds: number | undefined }
  | { allowed: false; code: RobotsDenyCode; matchedRule: string | null };

export type RobotsDenyCode =
  | "ROBOTS_UNAVAILABLE"
  | "ROBOTS_DISALLOWED"
  | "ROBOTS_MALFORMED";

/** 解析 robots.txt，返回适用于本采集器的合并规则组。 */
export function parseRobots(body: string): RobotsPolicy {
  // robots.txt 允许多个连续的 User-agent 行共享同一组规则。
  const groups: RobotsGroup[] = [];
  let pendingAgents: string[] = [];
  let current: RobotsGroup | undefined;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (line === "") continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      // 上一组已经开始收规则，说明这是新组的开头。
      if (current) {
        groups.push(current);
        current = undefined;
        pendingAgents = [];
      }
      pendingAgents.push(value.toLowerCase());
      continue;
    }

    if (pendingAgents.length === 0) continue; // 组外指令，忽略。
    current ??= { agents: [...pendingAgents], disallow: [], allow: [], crawlDelaySeconds: undefined };

    if (field === "disallow") current.disallow.push(value);
    else if (field === "allow") current.allow.push(value);
    else if (field === "crawl-delay") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) current.crawlDelaySeconds = parsed;
    }
  }
  if (current) groups.push(current);

  // 具名匹配优先于通配组；两者都存在时只用具名组（符合 robots 惯例）。
  const named = groups.filter((group) =>
    group.agents.some((agent) => agent !== "*" && COLLECTOR_ROBOTS_TOKEN.startsWith(agent)),
  );
  const wildcard = groups.filter((group) => group.agents.includes("*"));
  const applicable = named.length > 0 ? named : wildcard;
  if (applicable.length === 0) return { group: undefined, hasApplicableGroup: false };

  const merged: RobotsGroup = {
    agents: applicable.flatMap((group) => group.agents),
    disallow: applicable.flatMap((group) => group.disallow),
    allow: applicable.flatMap((group) => group.allow),
    crawlDelaySeconds: applicable
      .map((group) => group.crawlDelaySeconds)
      .filter((value): value is number => value !== undefined)
      // 多组并存时取最严（最长等待）。
      .reduce<number | undefined>((max, value) => (max === undefined ? value : Math.max(max, value)), undefined),
  };
  return { group: merged, hasApplicableGroup: true };
}

function decodePathForMatch(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

/**
 * robots 路径规则匹配。支持 `*` 通配与 `$` 行尾锚定。
 */
function ruleMatches(rule: string, path: string): boolean {
  if (rule === "") return false; // 空 Disallow 表示不禁止任何内容。
  const anchored = rule.endsWith("$");
  const pattern = anchored ? rule.slice(0, -1) : rule;
  const segments = pattern.split("*");

  let cursor = 0;
  for (const [index, segment] of segments.entries()) {
    if (segment === "") {
      if (index === 0) continue;
      continue;
    }
    const found = index === 0 ? (path.startsWith(segment) ? 0 : -1) : path.indexOf(segment, cursor);
    if (found < 0) return false;
    cursor = found + segment.length;
  }
  if (anchored) {
    const lastSegment = segments.at(-1) ?? "";
    return lastSegment === "" ? true : path.endsWith(lastSegment) && cursor === path.length;
  }
  return true;
}

/** 取最长匹配规则；长度相同时 `Allow` 优先（robots 惯例）。 */
function longestMatch(rules: string[], path: string): string | null {
  let best: string | null = null;
  for (const rule of rules) {
    if (!ruleMatches(rule, path)) continue;
    if (best === null || rule.length > best.length) best = rule;
  }
  return best;
}

/**
 * 判定某个路径是否被 robots 允许。
 *
 * @param outcome robots.txt 的取回结果；`unavailable` 一律拒绝（fail-closed）。
 * @param pathWithQuery 已登记 fetch target 的路径（含 query，若有）。
 */
export function evaluateRobotsPath(
  outcome: RobotsFetchOutcome,
  pathWithQuery: string,
): RobotsDecision {
  if (outcome.status === "unavailable") {
    return { allowed: false, code: "ROBOTS_UNAVAILABLE", matchedRule: null };
  }

  let policy: RobotsPolicy;
  try {
    policy = parseRobots(outcome.body);
  } catch {
    return { allowed: false, code: "ROBOTS_MALFORMED", matchedRule: null };
  }

  // 没有任何适用组：robots 存在但未对本采集器或通配设限，视为允许。
  if (!policy.hasApplicableGroup || policy.group === undefined) {
    return { allowed: true, matchedRule: null, crawlDelaySeconds: undefined };
  }

  const path = decodePathForMatch(pathWithQuery);
  const disallowMatch = longestMatch(policy.group.disallow, path);
  const allowMatch = longestMatch(policy.group.allow, path);

  if (disallowMatch !== null) {
    // Allow 至少与 Disallow 同长时放行；否则禁止。
    const allowWins = allowMatch !== null && allowMatch.length >= disallowMatch.length;
    if (!allowWins) {
      return { allowed: false, code: "ROBOTS_DISALLOWED", matchedRule: disallowMatch };
    }
  }
  return {
    allowed: true,
    matchedRule: allowMatch,
    crawlDelaySeconds: policy.group.crawlDelaySeconds,
  };
}

/**
 * 把 `Crawl-delay` 折算为逐来源最小请求间隔，并与既有请求预算取更严者（ADR-0033 第四条）。
 */
export function effectiveMinimumIntervalMs(input: {
  configuredMinimumIntervalMs: number;
  crawlDelaySeconds: number | undefined;
}): number {
  const fromRobots =
    input.crawlDelaySeconds === undefined ? 0 : Math.ceil(input.crawlDelaySeconds * 1000);
  return Math.max(input.configuredMinimumIntervalMs, fromRobots);
}

export interface RobotsTargetCheck {
  /** 已登记 fetch target 的路径前缀。 */
  pathPrefix: string;
  method: "GET" | "POST";
}

export interface RobotsSourceVerdict {
  allowed: boolean;
  /** 被拒绝的原因码；allowed 为 true 时为 null。 */
  code: RobotsDenyCode | null;
  /** 首个被禁止的 target 路径；allowed 为 true 时为 null。 */
  blockedPathPrefix: string | null;
  matchedRule: string | null;
  /** 适用于本来源的 Crawl-delay（多 target 取最严）。 */
  crawlDelaySeconds: number | undefined;
}

/**
 * ADR-0033 第一条的逐来源判定：**全部**已登记 fetch target 都必须被 robots 允许，
 * 任一被禁止即整个来源不通过 `accessPolicyAccepted`。
 *
 * 这是每次调度刷新前的前置条件，而不是逐请求检查——因为判定对象是「已登记的访问范围」。
 */
export function evaluateRobotsForSource(
  outcome: RobotsFetchOutcome,
  targets: readonly RobotsTargetCheck[],
): RobotsSourceVerdict {
  if (outcome.status === "unavailable") {
    return {
      allowed: false,
      code: "ROBOTS_UNAVAILABLE",
      blockedPathPrefix: null,
      matchedRule: null,
      crawlDelaySeconds: undefined,
    };
  }
  if (targets.length === 0) {
    // 没有已登记目标就没有获准范围，不能记为允许。
    return {
      allowed: false,
      code: "ROBOTS_DISALLOWED",
      blockedPathPrefix: null,
      matchedRule: null,
      crawlDelaySeconds: undefined,
    };
  }

  let strictestDelay: number | undefined;
  for (const target of targets) {
    const decision = evaluateRobotsPath(outcome, target.pathPrefix);
    if (!decision.allowed) {
      return {
        allowed: false,
        code: decision.code,
        blockedPathPrefix: target.pathPrefix,
        matchedRule: decision.matchedRule,
        crawlDelaySeconds: undefined,
      };
    }
    if (decision.crawlDelaySeconds !== undefined) {
      strictestDelay =
        strictestDelay === undefined
          ? decision.crawlDelaySeconds
          : Math.max(strictestDelay, decision.crawlDelaySeconds);
    }
  }
  return {
    allowed: true,
    code: null,
    blockedPathPrefix: null,
    matchedRule: null,
    crawlDelaySeconds: strictestDelay,
  };
}
