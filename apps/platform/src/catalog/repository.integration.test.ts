import { JobDetailSchema, JobSearchQuerySchema, JobSearchResponseSchema } from "@aijob/contracts";
import { createDatabase } from "@aijob/database";
import { afterAll, describe, expect, it } from "vitest";
import { createCatalogRepository } from "./repository.js";

const databaseUrl = process.env.AIJOB_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("PostgreSQL catalog projection", () => {
  const db = createDatabase(databaseUrl ?? "postgresql://unused");

  afterAll(async () => {
    await db.destroy();
  });

  it("loads the server-fixed local_mvp projection and coverage facets", async () => {
    const repository = createCatalogRepository({
      db,
      enableLocalMvp: true,
    });
    const result = await repository.search(JobSearchQuerySchema.parse({ limit: 5 }));
    expect(JobSearchResponseSchema.parse(result)).toEqual(result);
    expect(result.facets.map(({ key }) => key)).toEqual(
      expect.arrayContaining([
        "company",
        "city",
        "jobFamily",
        "weeklyAttendanceDays",
        "durationMonths",
        "graduationYear",
        "sourceType",
        "freshness",
      ]),
    );

    const detail = (await Promise.all(result.items.map((item) => repository.get(item.id)))).find(
      (candidate) => candidate !== null,
    );
    if (detail) {
      expect(JobDetailSchema.parse(detail)).toEqual(detail);
      if (detail.officialLink) {
        expect(new URL(detail.officialLink).protocol).toBe("https:");
      }
    }
  });

  it("never exposes pending-review records from the public projection", async () => {
    const repository = createCatalogRepository({
      db,
      enableLocalMvp: false,
    });
    const result = await repository.search(JobSearchQuerySchema.parse({ limit: 100 }));
    expect(
      result.items.every(
        (item) => item.publicationState === "published" && item.internalPreview === undefined,
      ),
    ).toBe(true);
  });
});
