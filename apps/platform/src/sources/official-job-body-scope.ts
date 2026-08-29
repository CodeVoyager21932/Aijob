/**
 * ADR-0033 的 D1 内容边界：只保留做投递决定所必需的岗位职责与任职要求原句，
 * 不复制公司简介、企业宣传、福利待遇与职位亮点等营销文案。
 *
 * 有些雇主会把这些段落塞进 ATS 的「职责」字段本身，因此字段级提取并不足以满足 D1。
 * 实测：汇测（`huice-campus-internships`，北森租户）65 条岗位中 20 条的职责含公司简介、
 * 18 条含福利文案，平均长度 782 字符，远高于其余来源。
 *
 * 本裁剪器是**确定性**的，且只做删减：
 * - 只在正文出现明确的职责小标题时锚定，保留该标题之后的内容；
 * - 遇到后续的非职责小标题即停止；
 * - 找不到职责小标题时原样返回，不猜测、不改写、不生成任何新文本。
 */

/** 明确的职责小标题，例如 `【工作职责】`、`岗位职责：`、`一、工作内容`。 */
const DUTY_HEADING =
  /^(?:[【[（(]?\s*(?:[一二三四五六七八九十]+[、.）)]\s*)?)?(?:工作职责|岗位职责|职位职责|实习职责|主要职责|工作内容|主要工作内容|职责描述)\s*[】\]）)]?\s*[：:]?\s*$/u;

/** 明确的非职责小标题：出现即表示职责段落结束。 */
const NON_DUTY_HEADING =
  /^(?:[【[（(]?\s*(?:[一二三四五六七八九十]+[、.）)]\s*)?)?(?:公司简介|企业简介|公司介绍|企业介绍|关于我们|单位简介|机构简介|团队介绍|业务介绍|职位亮点|岗位亮点|职位诱惑|福利待遇|薪资待遇|员工福利|我们提供|你将获得|实习收获|任职要求|职位要求|岗位要求|任职资格|应聘要求|专业要求|申请方式|投递方式|联系方式|工作地点|其他信息)\s*[】\]）)]?\s*[：:]?\s*$/u;

function isDutyHeading(line: string): boolean {
  return DUTY_HEADING.test(line.normalize("NFKC").trim());
}

function isNonDutyHeading(line: string): boolean {
  return NON_DUTY_HEADING.test(line.normalize("NFKC").trim());
}

/**
 * 把雇主自撰的职责正文裁剪到 D1 允许的范围。
 *
 * 找不到职责小标题时返回原文（去除首尾空白）——无法确定哪些行是职责，就不删。
 */
export function scopeOfficialDutyText(value: string): string {
  const raw = value ?? "";
  const lines = raw.split(/\r?\n/);
  const dutyHeadingIndex = lines.findIndex((line) => isDutyHeading(line));
  if (dutyHeadingIndex < 0) return raw.trim();

  const afterHeading = lines.slice(dutyHeadingIndex + 1);
  const stopIndex = afterHeading.findIndex((line) => isNonDutyHeading(line));
  const scoped = stopIndex < 0 ? afterHeading : afterHeading.slice(0, stopIndex);
  const text = scoped.join("\n").trim();

  // 锚定后为空说明标题下没有内容，保留原文而不是丢掉全部证据。
  return text === "" ? raw.trim() : text;
}
