import { type NativeResumeDocument, parseNativeResumeDocument } from "@aijob/resume-core";

export const nativeRecoveryPrefix = "aijob:native-recovery:";
export interface NativeRecovery {
  baseRevision: number;
  document: NativeResumeDocument;
  title?: string;
}
export function nativeRecoveryKey(owner: string | null, documentId: string) {
  return owner
    ? `${nativeRecoveryPrefix}${encodeURIComponent(owner)}:${encodeURIComponent(documentId)}`
    : null;
}
export function readNativeRecovery(
  storage: Pick<Storage, "getItem" | "removeItem">,
  key: string | null,
  server: NativeRecovery,
): NativeRecovery | null {
  if (!key) return null;
  try {
    const text = storage.getItem(key);
    if (!text) return null;
    const value = JSON.parse(text);
    if (!Number.isSafeInteger(value.baseRevision) || value.baseRevision < 0)
      throw new Error("Invalid revision");
    const document = parseNativeResumeDocument(value.document);
    if(value.title!==undefined && (typeof value.title!=="string" || value.title.length>200))throw new Error("Invalid title");
    if ((value.title===undefined || value.title===server.title) && JSON.stringify(document) === JSON.stringify(parseNativeResumeDocument(server.document))) {
      storage.removeItem(key);
      return null;
    }
    return { baseRevision: value.baseRevision, document,...(value.title!==undefined?{title:value.title}:{}) };
  } catch {
    // A damaged recovery file must not prevent opening the server document.
    return null;
  }
}
export function clearNativeRecoveries(storage: Storage) {
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (key?.startsWith(nativeRecoveryPrefix)) storage.removeItem(key);
  }
}
