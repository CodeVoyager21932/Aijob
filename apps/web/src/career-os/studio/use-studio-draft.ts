import { useEffect, useState } from "react";
import {
  ResumeStudioDraftSchema,
  type ResumeStudioDraft,
  type SaveResumeStudioDraft,
} from "@aijob/contracts";
import {
  createIdempotencyKey,
  currentWorkspaceOwnerKey,
  subscribeToSessionBoundary,
} from "../../api/client";
import { getStudio, saveStudio } from "../../api/resume-studio";

type State = {
  draft: ResumeStudioDraft | null;
  status: "loading" | "saved" | "editing" | "saving" | "error";
  error: string;
  conflict: boolean;
};
export class DraftController {
  state: State = { draft: null, status: "loading", error: "", conflict: false };
  listeners = new Set<() => void>();
  sequence = 0;
  disposed = false;
  timer: ReturnType<typeof setTimeout> | undefined;
  running: Promise<ResumeStudioDraft | null> | undefined;
  pending: { body: SaveResumeStudioDraft; key: string; sequence: number } | undefined;
  undo: ResumeStudioDraft[] = [];
  redo: ResumeStudioDraft[] = [];
  private lastHistory: { key: string; at: number } | undefined;
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private recoveryKey() {
    const owner = currentWorkspaceOwnerKey();
    return owner ? `aijob:studio-recovery:${owner}:${this.id}` : null;
  }
  private recovery(clear = false) {
    clearTimeout(this.recoveryTimer);
    const key = this.recoveryKey();
    if (!key || typeof localStorage === "undefined") return;
    if (clear) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* Browser storage is optional. */
      }
      return;
    }
    this.recoveryTimer = setTimeout(() => {
      if (!this.disposed && this.state.draft) {
        try {
          localStorage.setItem(key, JSON.stringify(this.state.draft));
        } catch {
          /* The server save remains available. */
        }
      }
    }, 300);
  }
  constructor(readonly id: string) {
    void this.load();
  }
  persistRecoveryNow() {
    clearTimeout(this.recoveryTimer);
    const key=this.recoveryKey();
    if(!key||this.disposed||!this.state.draft||this.state.status==='saved')return;
    try{localStorage.setItem(key,JSON.stringify(this.state.draft));}catch{/* Storage is optional; never block navigation. */}
  }
  notify() {
    for (const fn of this.listeners) fn();
  }
  async load() {
    try {
      const d = await getStudio(this.id);
      if (this.disposed) return;
      if (!this.state.draft) {
        this.state = { draft: d, status: "saved", error: "", conflict: false };
        const key = this.recoveryKey();
        try {
          const text = key && localStorage.getItem(key),
            recovered = text ? ResumeStudioDraftSchema.safeParse(JSON.parse(text)) : null;
          if (
            recovered?.success &&
            recovered.data.documentId === d.documentId &&
            JSON.stringify([
              recovered.data.content,
              recovered.data.layout,
              recovered.data.title,
            ]) !== JSON.stringify([d.content, d.layout, d.title])
          ) {
            const sameRevision = recovered.data.revision === d.revision;
            this.state = {
              draft: { ...recovered.data, revision: d.revision },
              status: "editing",
              conflict: !sameRevision,
              error: sameRevision
                ? "已恢复这台浏览器中尚未同步的修改。"
                : "找回了本机尚未同步的修改，服务器也有新版本，请比较后保存。",
            };
            this.sequence++;
            if (sameRevision) this.timer = setTimeout(() => void this.flush(), 700);
          }
        } catch {
          /* Invalid or unavailable local recovery does not block the real document. */
        }
        this.notify();
      }
    } catch (e) {
      if (this.disposed) return;
      this.state = { ...this.state, status: "error", error: message(e) };
      this.notify();
    }
  }
  change(
    fn: (draft: ResumeStudioDraft) => ResumeStudioDraft,
    remember = true,
    groupKey?: string,
    immutable = false,
  ) {
    const old = this.state.draft;
    if (!old) return;
    const now = Date.now();
    const coalesce =
      groupKey && this.lastHistory?.key === groupKey && now - this.lastHistory.at < 1100;
    if (remember && !coalesce) {
      this.undo.push(old);
      if (this.undo.length > 60) this.undo.shift();
      this.redo = [];
    }
    this.lastHistory = groupKey ? { key: groupKey, at: now } : undefined;
    this.state = {
      ...this.state,
      draft: fn(immutable ? old : structuredClone(old)),
      status: "editing",
    };
    this.sequence++;
    this.recovery();
    this.notify();
    clearTimeout(this.timer);
    if (!this.state.conflict) this.timer = setTimeout(() => void this.flush(), 700);
  }
  travel(direction: "undo" | "redo") {
    this.lastHistory = undefined;
    const source = this[direction],
      current = this.state.draft,
      next = source.pop();
    if (!current || !next) return;
    this[direction === "undo" ? "redo" : "undo"].push(current);
    this.change(() => ({ ...next, revision: current.revision }), false);
  }
  flush(): Promise<ResumeStudioDraft | null> {
    clearTimeout(this.timer);
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async run() {
    while (
      !this.disposed &&
      this.state.draft &&
      this.state.status !== "saved" &&
      !this.state.conflict
    ) {
      const draft = this.state.draft;
      const pending = this.pending ?? {
        body: {
          expectedRevision: draft.revision,
          title: draft.title,
          content: draft.content,
          layout: draft.layout,
        },
        key: createIdempotencyKey(),
        sequence: this.sequence,
      };
      this.pending = pending;
      this.state = { ...this.state, status: "saving", error: "" };
      this.notify();
      try {
        const result = await saveStudio(this.id, pending.body, pending.key);
        if (this.disposed) return null;
        this.pending = undefined;
        const latest = this.state.draft;
        if (!latest) return null;
        const changed = this.sequence !== pending.sequence;
        const merged = changed
          ? {
              ...latest,
              revision: result.revision,
              updatedAt: result.updatedAt,
              content: {
                ...latest.content,
                sections: latest.content.sections.map((s) => ({
                  ...s,
                  entries: s.entries.map((e) => {
                    const saved = result.content.sections
                      .flatMap((section) => section.entries)
                      .find((se) => se.id === e.id);
                    return saved
                      ? {
                          ...e,
                          experienceId: saved.experienceId,
                          experienceRevision: saved.experienceRevision,
                        }
                      : e;
                  }),
                })),
              },
            }
          : result;
        this.state = {
          draft: merged,
          status: changed ? "editing" : "saved",
          error: "",
          conflict: false,
        };
        this.recovery(!changed);
        this.notify();
      } catch (error) {
        if (this.disposed) return null;
        const status=typeof error==='object'&&error!==null&&'status' in error?Number(error.status):0;
        if(status>=400&&status<500&&status!==408&&status!==429)this.pending=undefined;
        this.state = {
          ...this.state,
          status: "error",
          error: message(error),
          conflict:
            typeof error === "object" &&
            error !== null &&
            "status" in error &&
            error.status === 409,
        };
        this.notify();
        return null;
      }
    }
    return this.state.status === "saved" ? this.state.draft : null;
  }
  async refresh(remember = false) {
    await this.flush();
    if (this.state.status !== "saved") return;
    const sequence = this.sequence;
    const d = await getStudio(this.id);
    if (!this.disposed && sequence === this.sequence && this.state.status === "saved") {
      if (
        remember &&
        this.state.draft &&
        JSON.stringify(d.content) !== JSON.stringify(this.state.draft.content)
      ) {
        this.undo.push(this.state.draft);
        this.redo = [];
      }
      this.state = { draft: d, status: "saved", error: "", conflict: false };
      this.notify();
    }
  }
  async resolveWithCurrent(reviewedRevision: number) {
    if (this.disposed) return null;
    this.pending = undefined;
    this.state = {
      ...this.state,
      conflict: false,
      status: "editing",
      draft: this.state.draft ? { ...this.state.draft, revision: reviewedRevision } : null,
    };
    return this.flush();
  }
  async acceptServerVersion(remote: ResumeStudioDraft) {
    if (this.disposed || remote.documentId !== this.id) return null;
    this.change(() => structuredClone(remote));
    return this.resolveWithCurrent(remote.revision);
  }
  dispose() {
    this.recovery(true);
    this.disposed = true;
    clearTimeout(this.timer);
    this.state = { draft: null, status: "loading", error: "", conflict: false };
    this.undo = [];
    this.redo = [];
    this.pending = undefined;
    this.notify();
  }
}
function message(e: unknown) {
  return e instanceof Error ? e.message : "保存暂时失败，输入仍在；恢复网络后可以重试。";
}
const controllers = new Map<string, DraftController>();
export async function flushOpenStudioDraft(id: string) {
  const c = controllers.get(id);
  if (c) {
    const saved = await c.flush();
    if (!saved) throw new Error("简历还有尚未保存的修改，请回到编辑页处理后再继续。");
  }
}
export async function refreshOpenStudioDraft(id: string) {
  const c = controllers.get(id);
  if (c) await c.refresh(true);
}
subscribeToSessionBoundary(() => {
  for (const controller of controllers.values()) controller.dispose();
  controllers.clear();
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith("aijob:studio-recovery:")) localStorage.removeItem(key);
    }
  } catch {
    /* Storage can be disabled. */
  }
});
export function useStudioDraft(id: string) {
  const [, render] = useState(0);
  let controller = controllers.get(id);
  if (!controller) {
    controller = new DraftController(id);
    controllers.set(id, controller);
  }
  const c = controller;
  useEffect(() => {
    const notify = () => render((n) => n + 1);
    c.listeners.add(notify);
    notify();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (c.state.status !== "saved" && c.state.status !== "loading") {
        c.persistRecoveryNow();
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      c.listeners.delete(notify);
      window.removeEventListener("beforeunload", beforeUnload);
      void c.flush();
    };
  }, [c]);
  return {
    ...c.state,
    change: c.change.bind(c),
    changeImmutable: (fn: (draft: ResumeStudioDraft) => ResumeStudioDraft, groupKey?: string) =>
      c.change(fn, true, groupKey, true),
    flush: c.flush.bind(c),
    refresh: c.refresh.bind(c),
    resolveWithCurrent: c.resolveWithCurrent.bind(c),
    acceptServerVersion: c.acceptServerVersion.bind(c),
    undo: () => c.travel("undo"),
    redo: () => c.travel("redo"),
    canUndo: c.undo.length > 0,
    canRedo: c.redo.length > 0,
  };
}
