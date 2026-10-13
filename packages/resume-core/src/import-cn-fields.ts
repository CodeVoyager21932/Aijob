/** Extract explicit header fields only; prose remains in the description. */
export const importPeriod =
  /(?:19|20)\d{2}(?:[.年/-]\d{1,2}月?)?\s*[–—~～至-]\s*(?:(?:19|20)\d{2}(?:[.年/-]\d{1,2}月?)?|至今|现在|今)/;
const degree = /博士研究生|硕士研究生|博士|硕士|本科|学士|专科/;
const grade =
  /(?:GPA\s*[:：]?\s*\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?|绩点\s*[:：]?\s*\d+(?:\.\d+)?)/i;
const clean = (value: string) => value.replace(/^[\s•·|｜:：()（）-]+|[\s•·|｜:：()（）-]+$/g, "");
const parts = (value: string) =>
  value
    .split(/\s*[•|｜]\s*|\s+·\s+|\s{2,}|[()（）]/)
    .map(clean)
    .filter(Boolean);
// Student employers are not necessarily incorporated companies. Apply the
// same organization boundary to inline headers and date-first follow-ups.
const organizationSuffix =
  "(?:有限责任公司|有限公司|律师事务所|会计师事务所|事务所|工作室|研究院|研究所|实验室|基金会|出版社|电视台|集团|公司|律所|医院|学校|大学|学院|银行|分行|协会|中心|科技)";
const organizationPrefix = new RegExp(`^(.+?${organizationSuffix})(?=\\s|[•|｜]|$)`);
const standaloneOrganization = new RegExp(`${organizationSuffix}$`);
export function isStandaloneOrganizationLine(value: string) {
  return standaloneOrganization.test(value.trim());
}
export function educationHeader(
  text: string,
  item: {
    school: string;
    degree: string;
    area: string;
    grade: string;
    period: string;
    location: string;
  },
) {
  const gradePrefix = text.match(
    /^(?:成绩\s*[:：]\s*)?((?:GPA|绩点)\s*[:：]?\s*\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)\s*[,，;；]?\s*/i,
  );
  if (gradePrefix && !item.grade) {
    item.grade = gradePrefix[1] ?? "";
    text = text.slice(gradePrefix[0].length);
  }
  if (/[。；]/.test(text)) return text;
  let rest = text;
  for (const [key, pattern] of [
    ["period", importPeriod],
    ["degree", degree],
    ["grade", grade],
  ] as const) {
    const value = rest.match(pattern)?.[0];
    if (value) {
      if (!item[key]) item[key] = value;
      rest = rest.replace(value, "");
    }
  }
  if (item.school) rest = rest.replace(item.school, "");
  const location = rest.match(/(?:校区|地点)\s*[:：]\s*([^•|｜()（）]+)/);
  if (location && !item.location) {
    item.location = clean(location[1] ?? "");
    rest = rest.replace(location[0], "");
  }
  const explicit = rest.match(/专业\s*[:：]\s*([^•|｜()（）]+)/);
  if (explicit) {
    item.area = clean(explicit[1] ?? "");
    rest = rest.replace(explicit[0], "");
  }
  const remaining = parts(rest);
  // These are discipline names, not a loose "anything before a comma" classifier.
  const area = remaining.find((value) =>
    /^(?:自动化|信息管理|管理科学|计算机科学与技术|软件工程|工商管理|会计学|金融学|新闻学|传播学|法学|统计学|数学与应用数学|电子信息工程|机械工程|临床医学|生物科学|汉语言文学|英语)(?:专业)?$/.test(
      value,
    ),
  );
  if (area && !item.area) {
    item.area = area;
    rest = rest.replace(area, "");
  }
  return clean(rest);
}
export function experienceHeader(
  text: string,
  item: { company: string; position: string; period: string; location: string },
  initial = false,
) {
  if (/[。；]/.test(text)) return text;
  let rest = text;
  const explicitPosition = rest.match(/^(?:职位|岗位|职务)\s*[:：]\s*([^,，;；。|｜]+)$/);
  if (explicitPosition && !item.position) {
    item.position = clean(explicitPosition[1] ?? "");
    return "";
  }
  const period = rest.match(importPeriod)?.[0];
  if (period) {
    if (!item.period) item.period = period;
    rest = rest.replace(period, "");
  }
  const cities =
    /^(?:北京|上海|广州|深圳|杭州|南京|武汉|成都|西安|苏州|天津|重庆|郑州|长沙|厦门|合肥|远程)(?:市)?$/;
  const position =
    /^(?:[\p{Script=Han}A-Za-z /]{0,28})(?:实习生|助理|工程师|研究员|设计师|经理|专员|编辑|顾问|分析师|运营|开发)$/u;
  const roleFirst = initial
    ? rest.trim().match(/^(.+?(?:实习生|助理|工程师|研究员|设计师|经理|专员|编辑|顾问|分析师|运营|开发))\s*(?:[（(]([^）)]+)[）)])?\s+(.+)$/u)
    : null;
  if (
    roleFirst &&
    position.test(roleFirst[1] ?? "") &&
    (!roleFirst[2] || cities.test(roleFirst[2])) &&
    isStandaloneOrganizationLine(roleFirst[3] ?? "")
  ) {
    item.position = roleFirst[1] ?? "";
    item.location = roleFirst[2] ?? "";
    item.company = clean(roleFirst[3] ?? "");
    return "";
  }
  const organization = initial ? rest.match(organizationPrefix) : null;
  if (organization) {
    item.company = clean(organization[1] ?? "");
    rest = rest.slice(organization[0].length);
  }
  const fields = parts(rest);
  for (const field of fields) {
    if (cities.test(field)) {
      if (!item.location) item.location = field;
      rest = rest.replace(field, "");
    } else if (position.test(field)) {
      if (!item.position) item.position = field;
      rest = rest.replace(field, "");
    }
  }
  rest = clean(rest);
  if (initial) {
    if (!organization) {
      item.company = rest;
      return "";
    }
    return rest;
  }
  return rest;
}

export function projectMetadata(
  text: string,
  item: { role?: string; unit?: string; method?: string },
) {
  const match = text.match(
    /^(角色|本人角色|担任角色|所属单位|方法)\s*[:：]\s*([^，,；;。\n]+)([，,；;。]?)(.*)$/,
  );
  if (!match) return text;
  const key = match[1] === "所属单位" ? "unit" : match[1] === "方法" ? "method" : "role";
  if (item[key]) return text;
  item[key] = clean(match[2] ?? "");
  return (match[4] ?? "").trim();
}
