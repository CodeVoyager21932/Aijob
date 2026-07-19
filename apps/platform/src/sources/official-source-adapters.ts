import { MEITUAN_ADAPTER_VERSION } from "./meituan-official-adapter.js";
import { NANKAI_TAL_ADAPTER_VERSION } from "./nankai-tal-2027-adapter.js";
import { TENCENT_ADAPTER_VERSION } from "./tencent-campus-adapter.js";

export const controlledLocalSourceKeys = [
  "tencent-campus",
  "meituan-official",
  "nankai-tal-2027",
] as const;

export type ControlledLocalSourceKey = (typeof controlledLocalSourceKeys)[number];

export const officialSourceAdapterVersions: Record<ControlledLocalSourceKey, string> = {
  "tencent-campus": TENCENT_ADAPTER_VERSION,
  "meituan-official": MEITUAN_ADAPTER_VERSION,
  "nankai-tal-2027": NANKAI_TAL_ADAPTER_VERSION,
};

export function isControlledLocalSourceKey(value: string): value is ControlledLocalSourceKey {
  return controlledLocalSourceKeys.some((sourceKey) => sourceKey === value);
}

export function assertConfiguredAdapterVersion(
  sourceKey: string,
  adapterKey: string,
  adapterVersion: string,
): asserts sourceKey is ControlledLocalSourceKey {
  if (!isControlledLocalSourceKey(sourceKey) || adapterKey !== sourceKey) {
    throw new Error("ADAPTER_NOT_IMPLEMENTED");
  }
  if (officialSourceAdapterVersions[sourceKey] !== adapterVersion) {
    throw new Error("ADAPTER_VERSION_MISMATCH");
  }
}
