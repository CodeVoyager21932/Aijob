import { BAIDU_INTERNSHIPS_ADAPTER_VERSION } from "./baidu-internships-adapter.js";
import { BYTEDANCE_MANUAL_BROWSER_ADAPTER_VERSION } from "./bytedance-manual-browser-adapter.js";
import { JD_CAMPUS_INTERNSHIPS_ADAPTER_VERSION } from "./jd-campus-internships-adapter.js";
import { MEITUAN_ADAPTER_VERSION } from "./meituan-official-adapter.js";
import { NANKAI_TAL_ADAPTER_VERSION } from "./nankai-tal-2027-adapter.js";
import { TENCENT_ADAPTER_VERSION } from "./tencent-campus-adapter.js";

export const officialSourceAdapterVersions = {
  "baidu-ssr-deterministic-html": BAIDU_INTERNSHIPS_ADAPTER_VERSION,
  "bytedance-manual-browser-snapshot": BYTEDANCE_MANUAL_BROWSER_ADAPTER_VERSION,
  "jd-campus-public-api": JD_CAMPUS_INTERNSHIPS_ADAPTER_VERSION,
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
