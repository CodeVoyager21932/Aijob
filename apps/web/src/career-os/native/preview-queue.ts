import type { NativeResumeDocument } from "@aijob/resume-core";
import type { LocalFont, NativeItemAnchor } from "@aijob/resume-renderer/browser";

type Preview = { blob: Blob; anchors: NativeItemAnchor[] };
type Reply = Preview & { generation: number; error?: string };
type Port = Pick<Worker, "postMessage" | "terminate"> & {
  onmessage: ((event: MessageEvent<Reply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};
type Job = {
  id: number;
  document: NativeResumeDocument;
  fonts: LocalFont[];
  signal: AbortSignal;
  resolve: (result: Preview) => void;
  reject: (error: Error) => void;
  abort: () => void;
};

/** One native layout engine per tab; abandoned work drains before the next job. */
export class NativePreviewQueue {
  private port: Port | null = null;
  private pending: Job[] = [];
  private active: Job | null = null;
  private sequence = 0;
  private fontsSent = false;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private idle: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private createPort: () => Port,
    private timeoutMs = 60_000,
  ) {}

  render(document: NativeResumeDocument, fonts: LocalFont[], signal: AbortSignal) {
    return new Promise<Preview>((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException("预览已取消", "AbortError"));
      const job: Job = {
        id: this.sequence + 1,
        document,
        fonts,
        signal,
        resolve,
        reject,
        abort: () => {
          this.pending = this.pending.filter((item) => item !== job);
          reject(new DOMException("预览已取消", "AbortError"));
          signal.removeEventListener("abort", job.abort);
          // An active worker still occupies the slot until completion or timeout.
        },
      };
      this.sequence = job.id;
      signal.addEventListener("abort", job.abort, { once: true });
      this.pending.push(job);
      this.pump();
    });
  }

  dispose() {
    clearTimeout(this.timeout);
    clearTimeout(this.idle);
    for (const job of [...this.pending, ...(this.active ? [this.active] : [])]) {
      job.signal.removeEventListener("abort", job.abort);
      job.reject(new DOMException("预览已关闭", "AbortError"));
    }
    this.pending = [];
    this.active = null;
    this.resetPort();
  }

  private resetPort() {
    this.port?.terminate();
    this.port = null;
    this.fontsSent = false;
  }

  private finish(error?: Error, result?: Preview) {
    const job = this.active;
    if (!job) return;
    clearTimeout(this.timeout);
    job.signal.removeEventListener("abort", job.abort);
    this.active = null;
    if (!job.signal.aborted) {
      if (error) job.reject(error);
      else if (result) job.resolve(result);
    }
    this.pump();
  }

  private pump() {
    clearTimeout(this.idle);
    if (this.active) return;
    const job = this.pending.shift();
    if (!job) {
      this.idle = setTimeout(() => this.resetPort(), 30_000);
      return;
    }
    this.active = job;
    try {
      if (!this.port) {
        const port = this.createPort();
        this.port = port;
        port.onmessage = ({ data }) => {
          if (this.port !== port) return;
          if (data.generation !== this.active?.id) return;
          this.finish(data.error ? new Error(data.error) : undefined, data);
        };
        port.onerror = () => {
          if (this.port !== port) return;
          this.resetPort();
          this.finish(new Error("预览引擎未加载，输入和保存不受影响。"));
        };
      }
      this.timeout = setTimeout(() => {
        this.resetPort();
        this.finish(new Error("排版超过等待时间，请重试；输入和保存不受影响。"));
      }, this.timeoutMs);
      this.port.postMessage({
        generation: job.id,
        document: job.document,
        ...(this.fontsSent ? {} : { fonts: job.fonts }),
      });
      this.fontsSent = true;
    } catch (error) {
      this.resetPort();
      this.finish(error instanceof Error ? error : new Error("预览未生成"));
    }
  }
}

export const nativePreviewQueue = new NativePreviewQueue(
  () => new Worker(new URL("./native-preview.worker.ts", import.meta.url), { type: "module" }),
);
if (typeof window !== "undefined")
  window.addEventListener("pagehide", () => nativePreviewQueue.dispose());
