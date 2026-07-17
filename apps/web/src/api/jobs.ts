import type { JobDetail, JobListResponse } from "@aijob/contracts";

const baseUrl = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function requestJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    let code: string | undefined;
    try {
      const problem = (await response.json()) as {
        detail?: string;
        title?: string;
        code?: string;
      };
      message = problem.detail || problem.title || message;
      code = problem.code;
    } catch {
      // 非 JSON 错误页不进入界面或日志正文。
    }
    throw new ApiError(message, response.status, code);
  }

  return (await response.json()) as T;
}

export function getInternalPreviewJobs(signal?: AbortSignal) {
  return requestJson<JobListResponse>("/v1/internal-preview/jobs", signal);
}

export function getInternalPreviewJob(jobId: string, signal?: AbortSignal) {
  return requestJson<JobDetail>(`/v1/internal-preview/jobs/${encodeURIComponent(jobId)}`, signal);
}
