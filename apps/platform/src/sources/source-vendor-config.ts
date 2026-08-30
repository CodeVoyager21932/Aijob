import { z } from "zod";

/**
 * ADR-0034 第三条：来源准入拆为厂商层与租户层。
 *
 * `config/sources/` 现有 34 份配置共 5202 行，平均每家 153 行手写政策 JSON，1000 家推算约 15 万行。
 * 实测这些行里大部分不是逐企业事实，而是**同一个厂商判断被重复书写**：北森族 5 个租户里，
 * `noAuthBypass`、`officialApplyLink`、`accessPolicyAccepted` 三道门的结论完全一致，只有措辞不同
 * （DIFF3–5 全是 `note` 的措辞差异）；请求预算、抓取间隔、适配器版本逐字相同；fetch/apply target
 * 完全可由租户子域推导。
 *
 * 因此厂商层承载**判断与默认值**，租户层只保留**逐企业事实**：
 *
 * | 层 | 内容 | 评估次数 |
 * |---|---|---|
 * | 厂商 | 服务条款结论、robots 主机模型、无需登录、投递直达形态、请求预算、刷新参数、适配器版本、URL 模板 | 一次，全部租户继承 |
 * | 租户 | 租户标识与路径变体、组织身份、`officialIdentity`、`targetSupply`、逐主机 robots 判定 | 逐企业 |
 *
 * 六道硬门的**语义不变**，只改变**评估单位**。厂商层结论必须带证据引用——厂商级继承会放大单点
 * 错误，这是该设计的代价，缓解方式是租户层保留独立的主体证明与供给核验。
 */

/**
 * robots 主机模型决定 robots 判定属于哪一层。
 *
 * - `single_host`：全部租户共用一个主机（如 Moka 的 `app.mokahr.com`），robots 由厂商层评一次。
 * - `per_tenant_subdomain`：每个租户一个子域（如北森 `<租户>.zhiye.com`、飞书招聘
 *   `<租户>.jobs.feishu.cn`），robots 必须逐租户核验，厂商层结论不能替代。
 */
export const VendorRobotsHostModelSchema = z.enum(["single_host", "per_tenant_subdomain"]);
export type VendorRobotsHostModel = z.infer<typeof VendorRobotsHostModelSchema>;

const vendorAssessedGateSchema = z.object({
  status: z.enum(["pass", "pending", "fail"]),
  note: z.string().min(1),
  /** 厂商层结论必须可追溯。缺证据引用的厂商级判断会在继承时放大成全族错误。 */
  evidenceRefs: z.array(z.string().min(1)).min(1),
});

const vendorScoredValueSchema = z.object({
  weight: z.number().int().positive(),
  score: z.number().int().nonnegative(),
  status: z.string().min(1),
  note: z.string().min(1),
});

const vendorTargetTemplateSchema = z
  .object({
    method: z.enum(["GET", "POST"]),
    /**
     * 主机模板。`{tenant}` 由租户标识替换；不含占位符时表示单主机厂商。
     */
    hostTemplate: z.string().min(1),
    /**
     * 路径模板。可以是字面路径，也可以是占位符（如 `{applyPath}`）。
     * 校验放在**渲染之后**：模板本身可能以 `{` 开头，渲染结果才必须是绝对路径。
     */
    pathTemplate: z.string().min(1),
    allowedQueryParameters: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const vendorSourceConfigSchema = z
  .object({
    schemaVersion: z.literal("vendor-1.0.0"),
    /** 厂商键，租户配置用 `vendor` 字段引用它。 */
    vendorKey: z.string().regex(/^[a-z0-9-]+$/),
    displayName: z.string().min(1),
    adapterKey: z.string().regex(/^[a-z0-9-]+$/),
    adapterVersion: z.string().min(1),
    robotsHostModel: VendorRobotsHostModelSchema,
    /** 该厂商全部租户共享的默认值。 */
    defaults: z
      .object({
        catalogRole: z.enum(["canonical", "discovery_only", "disabled"]),
        runtimeScope: z.enum(["test", "local", "alpha", "production"]),
        acquisitionMode: z.string().min(1),
        crawlIntervalMinimumHours: z.number().int().positive(),
        requestBudget: z
          .object({
            maxItems: z.number().int().positive(),
            maxPages: z.number().int().positive(),
            maxRequests: z.number().int().positive(),
            minimumIntervalMs: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
    /**
     * 具名准入画像。
     *
     * 实测北森族 5 个租户里，`sourceType`、`provenanceLevel`、`refreshCoverage`、`absencePolicy`
     * 四个字段**共变**：要么全是「企业自有站点」（`organization_owned` + 全量刷新 + 消失即关闭），
     * 要么全是「已核验 ATS 租户」（`verified_ats_tenant` + 跟踪记录 + 不按缺席关闭）。
     *
     * 因此不做四个独立覆盖项，而由租户选一个画像：一个字段替代四个，并且从结构上阻止不自洽的
     * 组合（例如 `verified_ats_tenant` 配全量刷新）。
     */
    profiles: z
      .record(
        z
          .object({
            sourceType: z.string().min(1),
            provenanceLevel: z.string().min(1),
            refreshCoverage: z.enum(["full_scope", "tracked_records", "manual_snapshot"]),
            absencePolicy: z.enum(["none", "close_after_two_complete_absences"]),
            /**
             * 结构评分随画像共变而非逐租户变化：企业自有站点画像实测 18，已核验 ATS 租户
             * 画像实测 16。放在画像里，逐租户就不必再抄一遍同一个判断。
             */
            structureScore: vendorScoredValueSchema,
          })
          .strict(),
      )
      .refine((value) => Object.keys(value).length > 0, {
        message: "vendor must declare at least one admission profile",
      }),
    defaultProfile: z.string().min(1),
    /**
     * 厂商级硬门：评一次，全部租户继承。
     *
     * 刻意**不含** `officialIdentity` 与 `targetSupply`——那两道门是逐企业事实（这家企业是否
     * 真的把招聘挂在该租户页、当前是否在招实习），不可由厂商结论替代。
     */
    inheritedGates: z
      .object({
        noAuthBypass: vendorAssessedGateSchema,
        officialApplyLink: vendorAssessedGateSchema,
        accessPolicyAccepted: vendorAssessedGateSchema,
      })
      .strict(),
    /** 厂商级评分：访问政策由厂商决定，不随租户或画像变化。结构评分见画像。 */
    inheritedScores: z
      .object({
        policyAccess: vendorScoredValueSchema,
      })
      .strict(),
    /** 全部租户共享的政策约束说明。租户层的说明追加在其后。 */
    policyNotes: z.array(z.string().min(1)).min(1),
    fetchTargets: z.array(vendorTargetTemplateSchema).min(1),
    applyTargets: z.array(vendorTargetTemplateSchema).min(1),
    /** 请求参数模板；`{...}` 占位符由租户参数替换。 */
    requestDefaults: z.record(z.unknown()).default({}),
  })
  .strict();

export type VendorSourceConfig = z.infer<typeof vendorSourceConfigSchema>;

/**
 * 渲染模板占位符。只替换 `{name}` 形式，且必须在参数里找到——找不到就抛错，不静默留下占位符。
 */
export function renderVendorTemplate(
  template: string,
  parameters: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name: string) => {
    const value = parameters[name];
    if (value === undefined) {
      throw new Error(`VENDOR_TEMPLATE_PARAMETER_MISSING:${name}`);
    }
    return value;
  });
}
