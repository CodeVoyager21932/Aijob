import {
  blankResumeStudioContent,
  ResumeStudioLayoutSchema,
  type ResumeStudioDraft,
} from "@aijob/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ getStudio: vi.fn(), saveStudio: vi.fn() }));
vi.mock("../../api/resume-studio", () => api);
vi.mock("../../api/client", () => ({
  currentWorkspaceOwnerKey: () => 'test-owner',
  createIdempotencyKey: () => crypto.randomUUID(),
  subscribeToSessionBoundary: () => () => {},
}));
import { DraftController } from "./use-studio-draft";
const fixture = (): ResumeStudioDraft => ({
  documentId: crypto.randomUUID(),
  revision: 1,
  title: "我的简历",
  content: blankResumeStudioContent(),
  layout: ResumeStudioLayoutSchema.parse({}),
  updatedAt: new Date().toISOString(),
  contentRevisionId: null,
  layoutRevisionId: null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const controllers: DraftController[] = [];
const recovery = new Map<string,string>();
async function loaded() {
  const draft = fixture();
  api.getStudio.mockResolvedValueOnce(draft);
  const controller = new DraftController(draft.documentId);
  controllers.push(controller);
  await Promise.resolve();
  return controller;
}
beforeEach(() => {
  recovery.clear();
  vi.stubGlobal('localStorage',{getItem:(key:string)=>recovery.get(key)??null,setItem:(key:string,value:string)=>recovery.set(key,value),removeItem:(key:string)=>recovery.delete(key)});
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  for (const c of controllers.splice(0)) c.dispose();
  vi.useRealTimers();
});
describe("studio input continuity", () => {
  it('coalesces continuous typing, separates fields, and keeps redo available',async()=>{
    const c=await loaded();
    for(const text of ['我','我的','我的经历'])c.change(d=>({...d,title:text}),true,'title');
    expect(c.undo).toHaveLength(1);
    c.change(d=>({...d,content:{...d.content,basics:{...d.content.basics,headline:'产品'}}}),true,'headline');
    c.travel('undo');expect(c.state.draft?.content.basics.headline).toBe('');
    c.travel('undo');expect(c.state.draft?.title).toBe('我的简历');
    c.travel('redo');expect(c.state.draft?.title).toBe('我的经历');
  });
  it('restores unsynced text including a partially typed URL, but requires comparison if the server changed',async()=>{
    const draft=fixture(),local=structuredClone(draft);local.title='未同步的输入';local.content.basics.links=[{label:'作品',url:'https:'}];
    recovery.set(`aijob:studio-recovery:test-owner:${draft.documentId}`,JSON.stringify(local));
    api.getStudio.mockResolvedValueOnce({...draft,revision:2});
    const c=new DraftController(draft.documentId);controllers.push(c);await Promise.resolve();
    expect(c.state.draft?.title).toBe(local.title);expect(c.state.conflict).toBe(true);
    await c.flush();expect(api.saveStudio).not.toHaveBeenCalled();
    api.saveStudio.mockRejectedValueOnce(Object.assign(new Error('new revision'),{status:409}));
    await c.resolveWithCurrent(2);expect(c.state.conflict).toBe(true);expect(c.state.draft?.title).toBe(local.title);
    expect(api.saveStudio.mock.calls[0]?.[1].expectedRevision).toBe(2);
  });
  it('saves corrected input after a validation failure instead of replaying the rejected payload forever',async()=>{
    const c=await loaded();c.change(d=>({...d,title:''}));api.saveStudio.mockRejectedValueOnce(Object.assign(new Error('title required'),{status:400}));await c.flush();
    c.change(d=>({...d,title:'已补全标题'}));api.saveStudio.mockImplementationOnce(async(_id,body)=>({...c.state.draft,...body,revision:2}));await c.flush();
    expect(api.saveStudio.mock.calls[1]?.[1].title).toBe('已补全标题');expect(c.state.status).toBe('saved');
  });
  it('writes current input before navigation and clears owner-scoped recovery on disposal',async()=>{
    const c=await loaded();c.change(d=>({...d,title:'退出前的输入'}));c.persistRecoveryNow();
    expect([...recovery.values()][0]).toContain('退出前的输入');c.dispose();expect(recovery.size).toBe(0);
  });
  it("retains new input while an earlier save is in flight and saves against its returned revision", async () => {
    const c = await loaded(),
      waiting = deferred<ResumeStudioDraft>();
    c.change((d) => {
      d.content.basics.headline = "第一段";
      return d;
    });
    const sent = structuredClone(c.state.draft!);
    api.saveStudio
      .mockReturnValueOnce(waiting.promise)
      .mockImplementationOnce(async (_id, body) => ({ ...sent, ...body, revision: 3 }));
    const saving = c.flush();
    c.change((d) => {
      d.content.basics.headline = "新输入不能被覆盖";
      return d;
    });
    waiting.resolve({ ...sent, revision: 2 });
    await saving;
    expect(c.state.draft?.content.basics.headline).toBe("新输入不能被覆盖");
    expect(api.saveStudio.mock.calls[1]?.[1].expectedRevision).toBe(2);
    expect(c.state.status).toBe("saved");
  });
  it("does not overwrite text entered while a server refresh is pending", async () => {
    const c = await loaded(),
      waiting = deferred<ResumeStudioDraft>(),
      before = structuredClone(c.state.draft!);
    api.getStudio.mockReturnValueOnce(waiting.promise);
    const refreshing = c.refresh();
    await Promise.resolve();
    c.change((d) => {
      d.content.basics.headline = "刷新过程中仍可输入";
      return d;
    });
    waiting.resolve(before);
    await refreshing;
    expect(c.state.draft?.content.basics.headline).toBe("刷新过程中仍可输入");
    expect(c.state.status).toBe("editing");
  });
  it("a late refresh cannot restore data after the owner boundary is disposed", async () => {
    const c = await loaded(),
      waiting = deferred<ResumeStudioDraft>(),
      before = structuredClone(c.state.draft!);
    api.getStudio.mockReturnValueOnce(waiting.promise);
    const refreshing = c.refresh();
    await Promise.resolve();
    c.dispose();
    waiting.resolve(before);
    await refreshing;
    expect(c.state.draft).toBeNull();
    expect(c.undo).toEqual([]);
  });
});
