const { Client } = require("../../../packages/database/node_modules/pg");

process.env.M1_PUBLIC_TITLE ||= "M4 合成产品实习生";
const { seedBaseResume, seedCatalog } = require("./m1-browser-gate.cjs");

const databaseUrl = process.env.M4_DATABASE_URL;
const command = process.argv[2];
const caseId = process.argv[3];

function assertSafeDatabaseUrl(value) {
  if (!value) throw new Error("M4_DATABASE_URL is required");
  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (!loopbackHosts.has(parsed.hostname) || !/^aijob_.+_test(?:_|$)/.test(databaseName)) {
    throw new Error("M4 fixture requires a loopback aijob_*_test_* database");
  }
}

async function main() {
  assertSafeDatabaseUrl(databaseUrl);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    if (command === "seed-job") {
      const jobId = await seedCatalog(client);
      process.stdout.write(`${JSON.stringify({ command, jobId })}\n`);
      return;
    }
    if (command === "seed-resume") {
      if (!caseId || !/^[0-9a-f-]{36}$/i.test(caseId)) {
        throw new Error("seed-resume requires a Case UUID");
      }
      await seedBaseResume(client, caseId);
      process.stdout.write(`${JSON.stringify({ command, caseId })}\n`);
      return;
    }
    throw new Error("Expected command: seed-job | seed-resume <case-id>");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
