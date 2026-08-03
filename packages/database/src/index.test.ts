import { describe, expect, it } from "vitest";
import { assertIsolatedTestDatabaseUrl } from "./index.js";

describe("assertIsolatedTestDatabaseUrl", () => {
  it.each([
    "postgresql://aijob:aijob@127.0.0.1:5432/aijob_test",
    "postgresql://aijob:aijob@localhost:5432/aijob_test_worker_1",
    "postgresql://aijob:aijob@[::1]:5432/aijob_audit_20260803",
    "postgresql://aijob:aijob@127.0.0.1:5432/aijob_p0_audit",
    "postgresql://aijob:aijob@127.0.0.1:5432/aijob_import_test_20260803",
  ])("accepts isolated local database %s", (databaseUrl) => {
    expect(() => assertIsolatedTestDatabaseUrl(databaseUrl)).not.toThrow();
  });

  it.each([
    "postgresql://aijob:aijob@127.0.0.1:5432/aijob",
    "postgresql://aijob:aijob@db.example.test:5432/aijob_test",
    "postgresql://aijob:aijob@127.0.0.1:5432/postgres",
    "not-a-url",
  ])("rejects unsafe database %s", (databaseUrl) => {
    expect(() => assertIsolatedTestDatabaseUrl(databaseUrl)).toThrow();
  });
});
