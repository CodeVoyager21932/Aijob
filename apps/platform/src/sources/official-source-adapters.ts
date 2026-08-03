import type { AcquisitionMode } from "@aijob/contracts";
import { z } from "zod";
import {
  BAIDU_INTERNSHIPS_ADAPTER_VERSION,
  BAIDU_INTERNSHIPS_NORMALIZER_VERSION,
} from "./baidu-internships-adapter.js";
import {
  BeisenZhiyeAdapterOptionsSchema,
  BEISEN_ZHIYE_ADAPTER_VERSION,
  BEISEN_ZHIYE_NORMALIZER_VERSION,
} from "./beisen-zhiye-adapter.js";
import {
  BYTEDANCE_MANUAL_BROWSER_ADAPTER_VERSION,
  BYTEDANCE_MANUAL_BROWSER_NORMALIZER_VERSION,
} from "./bytedance-manual-browser-adapter.js";
import {
  FANRUAN_TRAINEE_ADAPTER_VERSION,
  FANRUAN_TRAINEE_NORMALIZER_VERSION,
} from "./fanruan-trainee-adapter.js";
import {
  JD_CAMPUS_INTERNSHIPS_ADAPTER_VERSION,
  JD_CAMPUS_INTERNSHIPS_NORMALIZER_VERSION,
} from "./jd-campus-internships-adapter.js";
import { MEITUAN_ADAPTER_VERSION, MEITUAN_NORMALIZER_VERSION } from "./meituan-official-adapter.js";
import {
  NANKAI_TAL_ADAPTER_VERSION,
  NANKAI_TAL_NORMALIZER_VERSION,
} from "./nankai-tal-2027-adapter.js";
import {
  OFFICIAL_ACCOUNT_MANUAL_ADAPTER_VERSION,
  OFFICIAL_ACCOUNT_MANUAL_NORMALIZER_VERSION,
} from "./official-account-manual-adapter.js";
import {
  TENCENT_ADAPTER_VERSION,
  TENCENT_NORMALIZER_VERSION,
} from "./tencent-campus-adapter.js";
import {
  UniversityEmploymentAdapterOptionsSchema,
  SUSTECH_BYSJY_ADAPTER_VERSION,
  SUSTECH_BYSJY_NORMALIZER_VERSION,
  UNIVERSITY_EMPLOYMENT_ADAPTER_VERSION,
  UNIVERSITY_EMPLOYMENT_NORMALIZER_VERSION,
} from "./university-employment-adapter.js";

export type ProbeHandlerKey =
  | "baidu"
  | "beisen-zhiye"
  | "fanruan-trainee"
  | "jd-campus"
  | "meituan"
  | "nankai-tal"
  | "tencent"
  | "university-employment";

export type ManualHandlerKey = "bytedance-browser" | "official-account-browser";

export interface OfficialSourceAdapterDescriptor {
  adapterKey: string;
  adapterVersion: string;
  normalizerVersion: string;
  pipelineVersion: string;
  acquisitionMode: AcquisitionMode;
  optionsSchema: z.ZodType;
  probeHandler: ProbeHandlerKey | null;
  manualHandler: ManualHandlerKey | null;
}

const noOptionsSchema = z.object({}).strict();
const positivePageSizeSchema = z.number().int().min(1).max(100);

const tencentOptionsSchema = z
  .object({
    projectIdList: z.array(z.number().int().positive()),
    projectMappingIdList: z.array(z.number().int().positive()),
    bgList: z.array(z.number().int().positive()),
    workCountryType: z.number().int().nonnegative(),
    workCityList: z.array(z.number().int().positive()),
    recruitCityList: z.array(z.number().int().positive()),
    pageIndex: z.number().int().positive(),
    pageSize: positivePageSizeSchema,
  })
  .strict();

const networkPipelineVersion = "1";
const manualPipelineVersion = "2";

export const officialSourceAdapterDescriptors = {
  "baidu-ssr-deterministic-html": {
    adapterKey: "baidu-ssr-deterministic-html",
    adapterVersion: BAIDU_INTERNSHIPS_ADAPTER_VERSION,
    normalizerVersion: BAIDU_INTERNSHIPS_NORMALIZER_VERSION,
    pipelineVersion: networkPipelineVersion,
    acquisitionMode: "deterministic_html",
    optionsSchema: z.object({ recruitType: z.literal("INTERN") }).strict(),
    probeHandler: "baidu",
    manualHandler: null,
  },
  "beisen-zhiye-public-api": {
    adapterKey: "beisen-zhiye-public-api",
    adapterVersion: BEISEN_ZHIYE_ADAPTER_VERSION,
    normalizerVersion: BEISEN_ZHIYE_NORMALIZER_VERSION,
    pipelineVersion: networkPipelineVersion,
    acquisitionMode: "public_api",
    optionsSchema: BeisenZhiyeAdapterOptionsSchema,
    probeHandler: "beisen-zhiye",
    manualHandler: null,
  },
  "bytedance-manual-browser-snapshot": {
    adapterKey: "bytedance-manual-browser-snapshot",
    adapterVersion: BYTEDANCE_MANUAL_BROWSER_ADAPTER_VERSION,
    normalizerVersion: BYTEDANCE_MANUAL_BROWSER_NORMALIZER_VERSION,
    pipelineVersion: manualPipelineVersion,
    acquisitionMode: "browser_required",
    optionsSchema: noOptionsSchema,
    probeHandler: null,
    manualHandler: "bytedance-browser",
  },
  "fanruan-trainee-public-api": {
    adapterKey: "fanruan-trainee-public-api",
    adapterVersion: FANRUAN_TRAINEE_ADAPTER_VERSION,
    normalizerVersion: FANRUAN_TRAINEE_NORMALIZER_VERSION,
    pipelineVersion: networkPipelineVersion,
    acquisitionMode: "public_api",
    optionsSchema: z
      .object({ filter: z.number().int().nonnegative(), page: z.number().int().positive() })
      .strict(),
    probeHandler: "fanruan-trainee",
    manualHandler: null,
  },
  "jd-campus-public-api": {
    adapterKey: "jd-campus-public-api",
    adapterVersion: JD_CAMPUS_INTERNSHIPS_ADAPTER_VERSION,
    normalizerVersion: JD_CAMPUS_INTERNSHIPS_NORMALIZER_VERSION,
    pipelineVersion: networkPipelineVersion,
    acquisitionMode: "public_api",
    optionsSchema: z
      .object({
        type: z.literal("internship"),
        pageIndex: z.number().int().nonnegative(),
        pageSize: positivePageSizeSchema,
      })
      .strict(),
    probeHandler: "jd-campus",
    manualHandler: null,
  },
  "tencent-public-api": {
    adapterKey: "tencent-public-api",
    adapterVersion: TENCENT_ADAPTER_VERSION,
    normalizerVersion: TENCENT_NORMALIZER_VERSION,
    pipelineVersion: networkPipelineVersion,
    acquisitionMode: "public_api",
    optionsSchema: tencentOptionsSchema,
    probeHandler: "tencent",
    manualHandler: null,
  },
  "meituan-public-api": {
    adapterKey: "meituan-public-api",
    adapterVersion: MEITUAN_ADAPTER_VERSION,
    normalizerVersion: MEITUAN_NORMALIZER_VERSION,
    pipelineVersion: networkPipelineVersion,
    acquisitionMode: "public_api",
    optionsSchema: noOptionsSchema,
    probeHandler: "meituan",
    manualHandler: null,
  },
  "nankai-tal-deterministic-html": {
    adapterKey: "nankai-tal-deterministic-html",
    adapterVersion: NANKAI_TAL_ADAPTER_VERSION,
    normalizerVersion: NANKAI_TAL_NORMALIZER_VERSION,
    pipelineVersion: networkPipelineVersion,
    acquisitionMode: "deterministic_html",
    optionsSchema: noOptionsSchema,
    probeHandler: "nankai-tal",
    manualHandler: null,
  },
  "official-account-manual-snapshot": {
    adapterKey: "official-account-manual-snapshot",
    adapterVersion: OFFICIAL_ACCOUNT_MANUAL_ADAPTER_VERSION,
    normalizerVersion: OFFICIAL_ACCOUNT_MANUAL_NORMALIZER_VERSION,
    pipelineVersion: manualPipelineVersion,
    acquisitionMode: "browser_required",
    optionsSchema: noOptionsSchema,
    probeHandler: null,
    manualHandler: "official-account-browser",
  },
  "university-employment-detail-html": {
    adapterKey: "university-employment-detail-html",
    adapterVersion: UNIVERSITY_EMPLOYMENT_ADAPTER_VERSION,
    normalizerVersion: UNIVERSITY_EMPLOYMENT_NORMALIZER_VERSION,
    pipelineVersion: networkPipelineVersion,
    acquisitionMode: "deterministic_html",
    optionsSchema: UniversityEmploymentAdapterOptionsSchema,
    probeHandler: "university-employment",
    manualHandler: null,
  },
  "university-employment-sustech-html": {
    adapterKey: "university-employment-sustech-html",
    adapterVersion: SUSTECH_BYSJY_ADAPTER_VERSION,
    normalizerVersion: SUSTECH_BYSJY_NORMALIZER_VERSION,
    pipelineVersion: networkPipelineVersion,
    acquisitionMode: "deterministic_html",
    optionsSchema: UniversityEmploymentAdapterOptionsSchema,
    probeHandler: "university-employment",
    manualHandler: null,
  },
} as const satisfies Record<string, OfficialSourceAdapterDescriptor>;

export type OfficialSourceAdapterKey = keyof typeof officialSourceAdapterDescriptors;

export const officialSourceAdapterVersions = Object.fromEntries(
  Object.entries(officialSourceAdapterDescriptors).map(([adapterKey, descriptor]) => [
    adapterKey,
    descriptor.adapterVersion,
  ]),
) as Record<OfficialSourceAdapterKey, string>;

export function isOfficialSourceAdapterKey(value: string): value is OfficialSourceAdapterKey {
  return Object.hasOwn(officialSourceAdapterDescriptors, value);
}

export function getOfficialSourceAdapterDescriptor(
  adapterKey: string,
): OfficialSourceAdapterDescriptor {
  if (!isOfficialSourceAdapterKey(adapterKey)) {
    throw new Error("ADAPTER_NOT_IMPLEMENTED");
  }
  return officialSourceAdapterDescriptors[adapterKey];
}

export function parseOfficialSourceAdapterOptions(
  adapterKey: string,
  value: unknown,
): Record<string, unknown> {
  const descriptor = getOfficialSourceAdapterDescriptor(adapterKey);
  const parsed = descriptor.optionsSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("ADAPTER_OPTIONS_INVALID", { cause: parsed.error });
  }
  return parsed.data as Record<string, unknown>;
}

export function assertConfiguredAdapterDescriptor(input: {
  adapterKey: string;
  adapterVersion: string;
  acquisitionMode: AcquisitionMode;
  adapterOptions: unknown;
}): asserts input is typeof input & { adapterKey: OfficialSourceAdapterKey } {
  const descriptor = getOfficialSourceAdapterDescriptor(input.adapterKey);
  if (descriptor.adapterVersion !== input.adapterVersion) {
    throw new Error("ADAPTER_VERSION_MISMATCH");
  }
  if (descriptor.acquisitionMode !== input.acquisitionMode) {
    throw new Error("ADAPTER_ACQUISITION_MODE_MISMATCH");
  }
  parseOfficialSourceAdapterOptions(input.adapterKey, input.adapterOptions);
}

export function assertConfiguredAdapterVersion(
  adapterKey: string,
  adapterVersion: string,
): asserts adapterKey is OfficialSourceAdapterKey {
  const descriptor = getOfficialSourceAdapterDescriptor(adapterKey);
  if (descriptor.adapterVersion !== adapterVersion) {
    throw new Error("ADAPTER_VERSION_MISMATCH");
  }
}
