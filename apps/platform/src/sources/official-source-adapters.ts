import { BAIDU_INTERNSHIPS_ADAPTER_VERSION } from "./baidu-internships-adapter.js";
import { BEISEN_ZHIYE_ADAPTER_VERSION } from "./beisen-zhiye-adapter.js";
import { BYTEDANCE_MANUAL_BROWSER_ADAPTER_VERSION } from "./bytedance-manual-browser-adapter.js";
import { FANRUAN_TRAINEE_ADAPTER_VERSION } from "./fanruan-trainee-adapter.js";
import { JD_CAMPUS_INTERNSHIPS_ADAPTER_VERSION } from "./jd-campus-internships-adapter.js";
import { MEITUAN_ADAPTER_VERSION } from "./meituan-official-adapter.js";
import { NANKAI_TAL_ADAPTER_VERSION } from "./nankai-tal-2027-adapter.js";
import { OFFICIAL_ACCOUNT_MANUAL_ADAPTER_VERSION } from "./official-account-manual-adapter.js";
import { TENCENT_ADAPTER_VERSION } from "./tencent-campus-adapter.js";
import { UNIVERSITY_EMPLOYMENT_ADAPTER_VERSION } from "./university-employment-adapter.js";

export const officialSourceAdapterVersions = {
  "baidu-ssr-deterministic-html": BAIDU_INTERNSHIPS_ADAPTER_VERSION,
  "beisen-zhiye-public-api": BEISEN_ZHIYE_ADAPTER_VERSION,
  "bytedance-manual-browser-snapshot": BYTEDANCE_MANUAL_BROWSER_ADAPTER_VERSION,
  "fanruan-trainee-public-api": FANRUAN_TRAINEE_ADAPTER_VERSION,
  "jd-campus-public-api": JD_CAMPUS_INTERNSHIPS_ADAPTER_VERSION,
  "tencent-public-api": TENCENT_ADAPTER_VERSION,
  "meituan-public-api": MEITUAN_ADAPTER_VERSION,
  "nankai-tal-deterministic-html": NANKAI_TAL_ADAPTER_VERSION,
  "official-account-manual-snapshot": OFFICIAL_ACCOUNT_MANUAL_ADAPTER_VERSION,
  "university-employment-detail-html": UNIVERSITY_EMPLOYMENT_ADAPTER_VERSION,
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
