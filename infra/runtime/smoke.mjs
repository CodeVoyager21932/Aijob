import { randomUUID } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import { createCatalogRepository } from "/opt/aijob/apps/platform/dist/catalog/repository.js";
import { parseResumeBuffer } from "/opt/aijob/apps/platform/dist/resume/parse.js";
import { renderResumePdf } from "/opt/aijob/apps/platform/dist/resume-documents/pdf-service.js";
import { JobSearchQuerySchema } from "/opt/aijob/packages/contracts/dist/index.js";
import { createDatabase } from "/opt/aijob/packages/database/dist/index.js";

const url = process.env.AIJOB_SMOKE_DATABASE_URL;
if (!url || !new URL(url).pathname.includes("_test"))
  throw new Error("Explicit test database required");
const db = createDatabase(url),
  sectionId = randomUUID();
try {
  for (const path of ["/opt/aijob/.env", "/opt/aijob/apps/web/.env"]) {
    if (
      await access(path).then(
        () => true,
        () => false,
      )
    )
      throw new Error("LOCAL_ENV_IN_IMAGE");
  }
  const catalog = await createCatalogRepository({ db, enableLocalMvp: true }).search(
    JobSearchQuerySchema.parse({ limit: 20 }),
  );
  const snapshot = {
    title: "中文导出运行环境验证",
    templateKey: "cn_classic_single_column",
    sectionOrder: [sectionId],
    settings: {
      schemaVersion: "resume-layout-settings-v1",
      fontSizeToken: "standard",
      lineSpacingToken: "standard",
      sectionSpacingToken: "standard",
      colorToken: "charcoal",
      pageBreakPolicy: "keep_sections",
    },
    content: {
      schemaVersion: "resume-content-v1",
      sections: [
        {
          id: sectionId,
          ordinal: 0,
          title: "项目经历",
          blocks: Array.from({ length: 70 }, (_, i) => ({
            id: randomUUID(),
            ordinal: i,
            text: `第 ${i + 1} 项：使用 SQL 分析校园问卷，整理数据并编写中文报告。`,
            evidenceIds: [],
          })),
        },
      ],
    },
  };
  const pdf = await renderResumePdf({
    db,
    snapshot,
    runtime: {
      executablePath: "/usr/bin/chromium",
      fontPath: "/opt/fonts/AijobCJK.otf",
      serifFontPath: "/opt/fonts/AijobSerifCJK.otf",
      concurrency: 1,
      timeoutMs: 30000,
    },
  });
  await writeFile("/output/linux-chinese-fixture.pdf", pdf);
  const text = await parseResumeBuffer({ kind: "pdf", buffer: pdf });
  if (!text.replace(/\s/g, "").includes("分析校园问卷"))
    throw new Error("CHINESE_TEXT_NOT_COPYABLE");
  console.log(
    JSON.stringify({
      platform: process.platform,
      chromiumSandbox: true,
      compiledCatalogQuery: true,
      localEnvExcluded: true,
      visibleJobs: catalog.totalKnown + catalog.totalUnknown,
      copyableChinese: true,
      bytes: pdf.length,
      pages: (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length,
    }),
  );
} finally {
  await db.destroy();
}
