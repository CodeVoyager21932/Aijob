import type { SourceTarget } from "../sources/source-config.js";
import type { RobotsFetchOutcome } from "./robots-policy.js";
import { NetworkPolicyError, safeRequestText } from "./safe-http.js";

/** 内容判定与错误分类都在本模块，`robots-policy.ts` 继续只做解析与判定、不触网。 */

/**
 * ADR-0033 取证通路里唯一发起网络请求的地方：取回 `robots.txt`。
 *
 * `robots-policy.ts` 刻意只做解析与判定、不触网，因此判定逻辑能用夹具完整测试。本模块补上缺的
 * 那一半，并把「`/robots.txt` 与白名单的关系」这个必须显式决定的问题在这里定下来：
 *
 * `/robots.txt` **不在任何来源的 fetchTargets 里**，也不应该被加进去——把它塞进某个来源的路径
 * 前缀会顺带放宽那个来源的获准访问范围。改为在这里**为每个主机现造一条只含该路径的目标**：
 * 精确路径（不是前缀）、GET、https、443、零查询参数、不允许重定向。主机必须已经出现在该来源
 * 已登记的 fetchTargets 中（由调用方核验），所以这不是新开主机，而是在已白名单主机上多取一个
 * 固定路径。这正是「在已白名单主机上视为隐含允许」的最小实现。
 *
 * 重定向按 `AGENTS.md`「重定向默认拒绝并重新校验」处理：3xx 记为 `unavailable`，让操作者看见是
 * 哪个主机改了跳转再决定，而不是默认跟随。
 */
export const ROBOTS_PATH = "/robots.txt";

export function robotsTargetForHost(host: string): SourceTarget {
  return {
    method: "GET",
    scheme: "https",
    host,
    port: 443,
    pathPrefix: ROBOTS_PATH,
    allowRedirects: false,
    allowedQueryParameters: [],
  };
}

export function robotsUrlForHost(host: string): string {
  return `https://${host}${ROBOTS_PATH}`;
}

export interface RobotsFetchRecord {
  host: string;
  requestUrl: string;
  outcome: RobotsFetchOutcome;
  /** 取回失败时的原始错误码，便于人工判断是站点改了还是本机网络问题。 */
  errorCode: string | null;
  /** 服务端声明的 content-type。只作留证，不参与判定。 */
  contentType?: string;
  /** 失败详情，例如被拒跳转的 Location。 */
  detail?: string | null;
}

/**
 * 把取回失败归到 ADR-0033 的四类原因。分类的目的不是穷举错误码，而是让「取不到」这件事
 * 在证据里可复核——四类都按禁止处理，但人看得出是 404 还是超时。
 */
export function robotsUnavailableReason(
  errorCode: string,
): "not_found" | "timeout" | "http_error" | "network_error" {
  if (errorCode === "UPSTREAM_HTTP_404" || errorCode === "UPSTREAM_HTTP_410") return "not_found";
  if (errorCode === "UPSTREAM_TIMEOUT" || errorCode === "ETIMEDOUT") return "timeout";
  if (/^UPSTREAM_HTTP_\d{3}$/.test(errorCode)) return "http_error";
  // 内容类型不是 text/plain、正文不是 UTF-8、被拒的重定向都归入 http_error：站点确实回了
  // 东西，只是不是 robots.txt。
  if (
    errorCode === "UNEXPECTED_CONTENT_TYPE" ||
    errorCode === "INVALID_TEXT" ||
    errorCode === "REDIRECT_NOT_ALLOWED" ||
    errorCode === "RESPONSE_TOO_LARGE" ||
    errorCode === "ROBOTS_RESPONSE_IS_MARKUP"
  ) {
    return "http_error";
  }
  return "network_error";
}

function errorCodeOf(error: unknown): string {
  if (error instanceof NetworkPolicyError) return error.code;
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "UNEXPECTED_ROBOTS_FETCH_ERROR";
}

/**
 * 「拿到的到底是不是 robots.txt」按**内容**判定，不按 content-type。
 *
 * 起因是实测：18 个已登记主机里 8 个（多为高校就业网）用非 `text/plain` 的 MIME 提供 robots.txt。
 * 按 RFC 9309 §2.3 从严会把它们全部记成「站点禁止」，而那是 MIME 不规范，不是访问政策——正是
 * 应当避免的假否决。反过来，站点把 `/robots.txt` 回成 HTML 页面通常是 SPA 的兜底路由（软 404），
 * 那种情况必须按 fail-closed 记为取不到，不能当「没有 robots 因此允许」。
 *
 * 因此判据只有一条：正文明显是 HTML/XML 文档就不是 robots.txt。其余交给 `parseRobots`——空文件
 * 与无适用组按 RFC 本就等于不设限，不需要在这里再加判断。
 */
export function looksLikeMarkupDocument(body: string): boolean {
  const head = body.slice(0, 1_024).trimStart().toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<?xml")) {
    return true;
  }
  return head.includes("<head") || head.includes("<body") || head.includes("<script");
}

export async function fetchRobotsTxt(input: {
  host: string;
  beforeRequest?: () => Promise<void> | void;
}): Promise<RobotsFetchRecord> {
  const target = robotsTargetForHost(input.host);
  const requestUrl = robotsUrlForHost(input.host);
  try {
    const response = await safeRequestText(
      { method: "GET", url: requestUrl },
      [target],
      input.beforeRequest ? { beforeRequest: input.beforeRequest } : {},
    );
    if (looksLikeMarkupDocument(response.text)) {
      return {
        host: input.host,
        requestUrl,
        outcome: { status: "unavailable", reason: "http_error" },
        errorCode: "ROBOTS_RESPONSE_IS_MARKUP",
        contentType: response.contentType,
      };
    }
    return {
      host: input.host,
      requestUrl,
      outcome: { status: "fetched", body: response.text },
      errorCode: null,
      contentType: response.contentType,
    };
  } catch (error) {
    const errorCode = errorCodeOf(error);
    return {
      host: input.host,
      requestUrl,
      outcome: { status: "unavailable", reason: robotsUnavailableReason(errorCode) },
      errorCode,
      // 拒绝跳转时错误信息里带着 Location，取证报告要能看到它。
      detail: error instanceof NetworkPolicyError ? error.message : null,
    };
  }
}
