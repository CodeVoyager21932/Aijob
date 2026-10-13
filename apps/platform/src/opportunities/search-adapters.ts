import type { SearchAdapter } from "@aijob/contracts";
import { userProviderFetch } from "../ai/user-provider-fetch.js";
import { normalizeLeadUrl, searchTavily } from "./discovery.js";

export const SEARCH_ADAPTER_VERSION = "search-2026-10-13-v1";
export type SearchLead = { url: string; title: string };
export type SearchResult = {
  leads: SearchLead[];
  toolCalls: number | null;
  modelTokens: number | null;
};
export class SearchError extends Error {
  constructor(
    readonly code: string,
    readonly capability: "unsupported" | "unrecognized" | "temporary_failure",
  ) {
    super(code);
  }
}
type RecordValue = Record<string, unknown>;
const record = (v: unknown): RecordValue =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as RecordValue) : {};
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const count = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;

export function selectSearchAdapter(
  baseUrl: string,
  requested: SearchAdapter,
): Exclude<SearchAdapter, "auto"> {
  if (requested !== "auto") return requested;
  const host = new URL(baseUrl).hostname;
  if (host === "openrouter.ai" || host === "us.openrouter.ai" || host === "eu.openrouter.ai")
    return "openrouter";
  if (
    host === "dashscope.aliyuncs.com" ||
    host === "dashscope-intl.aliyuncs.com" ||
    host.endsWith(".maas.aliyuncs.com")
  )
    return "bailian-responses";
  // A custom relay gets one standards-based probe on its own host, never its key on an inferred provider.
  return "openai-responses";
}
export function responsesEndpoint(baseUrl: string) {
  const url = new URL(baseUrl);
  url.pathname =
    url.pathname.replace(/\/(chat\/completions|responses)\/?$/, "").replace(/\/$/, "") +
    "/responses";
  return url.toString();
}
export function parseSearchResponse(
  body: unknown,
  adapter: Exclude<SearchAdapter, "auto">,
): SearchResult {
  const root = record(body),
    usage = record(root.usage),
    output = array(root.output).map(record);
  const usageCount =
    adapter === "openrouter"
      ? count(record(usage.server_tool_use).web_search_requests)
      : adapter === "bailian-responses"
        ? count(record(record(usage.x_tools).web_search).count)
        : null;
  const calls = output.filter(
    (v) =>
      v.type === "web_search_call" &&
      (v.status === "completed" || (v.status === undefined && (usageCount ?? 0) > 0)),
  );
  const tools = usageCount ?? (calls.length > 0 ? calls.length : null);
  if (!tools) throw new SearchError("SEARCH_TOOL_NOT_OBSERVED", "unrecognized");
  if (["failed", "incomplete", "in_progress", "queued", "cancelled"].includes(String(root.status)))
    throw new SearchError("SEARCH_RESPONSE_INCOMPLETE", "temporary_failure");
  const candidates: unknown[] = calls.flatMap((c) => array(record(c.action).sources));
  for (const item of output)
    for (const content of array(item.content)) {
      for (const annotation of array(record(content).annotations)) {
        const a = record(annotation);
        if (a.type === "url_citation") candidates.push(a.url_citation ?? a);
      }
    }
  const leads = new Map<string, SearchLead>();
  for (const candidate of candidates) {
    const source = record(candidate);
    if (typeof source.url !== "string") continue;
    const url = normalizeLeadUrl(source.url);
    if (url && url.length <= 2000)
      leads.set(url, {
        url,
        title:
          typeof source.title === "string" ? source.title.slice(0, 300) : new URL(url).hostname,
      });
  }
  if (!leads.size) throw new SearchError("SEARCH_SOURCES_MISSING", "unrecognized");
  const inputTokens = count(usage.input_tokens),
    outputTokens = count(usage.output_tokens);
  return {
    leads: [...leads.values()].slice(0, 20),
    toolCalls: tools,
    modelTokens:
      count(usage.total_tokens) ??
      (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
  };
}
export async function executeSearch(input: {
  query: string;
  apiKey: string;
  adapter: Exclude<SearchAdapter, "auto"> | "tavily";
  baseUrl?: string;
  model?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal | undefined;
  fetchImpl?: typeof fetch | undefined;
}): Promise<SearchResult> {
  if (input.signal?.aborted) throw new SearchError("SEARCH_CANCELLED", "temporary_failure");
  if (input.adapter === "tavily")
    return {
      leads: await searchTavily({
        query: input.query,
        apiKey: input.apiKey,
        ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      }),
      toolCalls: 1,
      modelTokens: null,
    };
  const tool =
    input.adapter === "openrouter"
      ? {
          type: "openrouter:web_search",
          parameters: { max_uses: 1, max_results: 10, max_total_results: 10 },
        }
      : { type: "web_search" };
  let response: Response;
  try {
    response = await (input.fetchImpl ?? userProviderFetch)(responsesEndpoint(input.baseUrl!), {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify({
        model: input.model,
        input: `请实际执行一次联网搜索，寻找企业官方招聘入口，不根据记忆编造。查询：${input.query}。只简短列出找到的官方入口。`,
        tools: [tool],
        max_tool_calls: 1,
        max_output_tokens: input.maxOutputTokens ?? 1024,
        ...(input.adapter === "openai-responses"
          ? { include: ["web_search_call.action.sources"], store: false }
          : {}),
      }),
      signal: input.signal
        ? AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs ?? 60000)])
        : AbortSignal.timeout(input.timeoutMs ?? 60000),
    });
  } catch {
    throw new SearchError("SEARCH_NETWORK_FAILED", "temporary_failure");
  }
  if (!response.ok)
    throw new SearchError(
      response.status === 401 || response.status === 403
        ? "SEARCH_AUTH_REQUIRED"
        : response.status === 429
          ? "SEARCH_RATE_LIMITED"
          : [400, 404, 405, 422, 501].includes(response.status)
            ? "SEARCH_METHOD_UNSUPPORTED"
            : "SEARCH_PROVIDER_FAILED",
      [400, 404, 405, 422, 501].includes(response.status) ? "unsupported" : "temporary_failure",
    );
  try {
    const text = await response.text();
    if (text.length > 1000000) throw new Error();
    return parseSearchResponse(JSON.parse(text), input.adapter);
  } catch (error) {
    if (error instanceof SearchError) throw error;
    throw new SearchError("SEARCH_RESPONSE_UNRECOGNIZED", "unrecognized");
  }
}
