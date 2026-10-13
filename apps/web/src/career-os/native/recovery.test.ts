import { createNativeResumeDocument } from "@aijob/resume-core";
import { describe, expect, it } from "vitest";
import { clearNativeRecoveries, nativeRecoveryKey, readNativeRecovery } from "./recovery";

function storage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  } satisfies Storage;
}
describe("native unsynced recovery", () => {
  it("does not discard an unsynced name when the document content is already acknowledged",()=>{
    const s=storage(),document=createNativeResumeDocument(),key=nativeRecoveryKey("a","b") as string;
    s.setItem(key,JSON.stringify({baseRevision:2,title:"产品方向稿",document}));
    expect(readNativeRecovery(s,key,{baseRevision:2,title:"原稿",document})?.title).toBe("产品方向稿");
    expect(readNativeRecovery(s,key,{baseRevision:3,title:"产品方向稿",document})).toBeNull();
  });
  it("isolates owners and retains diverged input for a choice instead of overwriting server data", () => {
    const s = storage(),
      document = createNativeResumeDocument();
    document.data.basics.name = "刚输入的名字";
    const key = nativeRecoveryKey("owner-a", "draft") as string;
    s.setItem(key, JSON.stringify({ baseRevision: 3, document }));
    const server = { baseRevision: 5, document: createNativeResumeDocument() };
    expect(readNativeRecovery(s, nativeRecoveryKey("owner-b", "draft"), server)).toBeNull();
    expect(readNativeRecovery(s, key, server)?.document.data.basics.name).toBe("刚输入的名字");
    expect(server.document.data.basics.name).not.toBe("刚输入的名字");
    expect(nativeRecoveryKey(null, "draft")).toBeNull();
  });
  it("removes an already acknowledged copy and ignores damaged payloads", () => {
    const s = storage(),
      document = createNativeResumeDocument(),
      key = nativeRecoveryKey("a", "b") as string;
    s.setItem(key, JSON.stringify({ baseRevision: 1, document }));
    expect(readNativeRecovery(s, key, { baseRevision: 2, document })).toBeNull();
    expect(s.getItem(key)).toBeNull();
    s.setItem(key, '{"baseRevision":1,"document":{}}');
    expect(readNativeRecovery(s, key, { baseRevision: 2, document })).toBeNull();
  });
  it("clears all native recovery copies on session deletion without touching unrelated storage", () => {
    const s = storage();
    s.setItem(nativeRecoveryKey("a", "b") as string, "private");
    s.setItem("theme", "light");
    clearNativeRecoveries(s);
    expect(s.length).toBe(1);
    expect(s.getItem("theme")).toBe("light");
  });
});
