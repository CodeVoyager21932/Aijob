import { MEITUAN_ADAPTER_VERSION } from "./meituan-official-adapter.js";
import { NANKAI_TAL_ADAPTER_VERSION } from "./nankai-tal-2027-adapter.js";
import { TENCENT_ADAPTER_VERSION } from "./tencent-campus-adapter.js";

export const officialSourceAdapterVersions = {
  "tencent-public-api": TENCENT_ADAPTER_VERSION,
  "meituan-public-api": MEITUAN_ADAPTER_VERSION,
  "nankai-tal-deterministic-html": NANKAI_TAL_ADAPTER_VERSION,
};

export type OfficialSourceAdapterKey = keyof typeof officialSourceAdapterVersions;

export function isOfficialSourceAdapterKey(value: string): value is OfficialSourceAdapterKey {
  return Object.hasOwn(officialSourceAdapterVersions, value);
}

export function assertConfiguredAdapterVersion(
  adapterKey: string,
  adapterVersion: string,
): asserts adapterKey is OfficialSourceAdapterKey {
  if (!isOfficialSourceAdapterKey(adapterKey)) {
    throw new Error("ADAPTER_NOT_IMPLEMENTED");
  }
  if (officialSourceAdapterVersions[adapterKey] !== adapterVersion) {
    throw new Error("ADAPTER_VERSION_MISMATCH");
  }
}
