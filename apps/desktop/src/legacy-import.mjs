import { createHash, randomBytes } from "node:crypto";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";

const exists = async (file) => {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
};
const activeOwner =
  "o.status='active' AND (o.retention_mode='account_managed' OR (o.retention_mode='persistent_guest' AND o.retention_expires_at IS NULL) OR (o.retention_mode='anonymous_ttl' AND o.retention_expires_at>now()))";
function pgEnvironment(url) {
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGCLIENTENCODING: "UTF8",
  };
}
async function oldSql(runtime, legacy, query) {
  return runtime.command(
    path.join(runtime.pg, "psql.exe"),
    ["-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", query],
    pgEnvironment(legacy.url),
  );
}
export async function inspectLegacy(runtime, directory) {
  const environment = parseEnv(await readFile(path.join(directory, ".env"), "utf8"));
  const database = environment.MIGRATOR_DATABASE_URL || environment.DATABASE_URL;
  if (!database) throw Error("旧工作区缺少数据库配置，请先确认所选目录。");
  const url = new URL(database);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw Error("此向导只迁移本机 PostgreSQL。");
  const masterKey =
    environment.RESUME_ENCRYPTION_KEY ||
    (await readFile(path.join(directory, ".data/resume-encryption.key"), "utf8")).trim();
  if (!/^[a-f0-9]{64}$/i.test(masterKey)) throw Error("旧工作区加密密钥不可读取，原资料未改变。");
  const legacy = {
    directory,
    url,
    masterKey,
    snapshotDirectory: path.resolve(directory, environment.SNAPSHOT_DIR || ".data/job-snapshots"),
  };
  const owners = JSON.parse(
    (
      await oldSql(
        runtime,
        legacy,
        `SELECT COALESCE(json_agg(t),'[]'::json) FROM (SELECT o.id, o.epoch, (SELECT count(*)::int FROM profile.resume_documents d WHERE d.owner_id=o.id AND d.deleted_at IS NULL) AS resumes, (SELECT count(*)::int FROM application.saved_searches s WHERE s.owner_id=o.id) AS directions, (SELECT count(*)::int FROM profile.ai_connections a WHERE a.owner_id=o.id) AS connections FROM identity.owners o WHERE ${activeOwner} ORDER BY (SELECT count(*) FROM application.saved_searches s WHERE s.owner_id=o.id) DESC, o.last_seen_at DESC) t`,
      )
    ).trim(),
  );
  return { ...legacy, owners };
}
export async function assertLegacyStopped(runtime, legacy) {
  // Inspect process metadata only; never execute scripts from the selected directory.
  const output = await runtime.command(
    path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$p=$env:AIJOB_OLD_WORKSPACE; $active=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|bun)(.exe)?$' -and $_.CommandLine -and $_.CommandLine.IndexOf($p,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine -match '((src|dist)[\\/](server|dev|(collector|match)-worker)\\.[cm]?[jt]s|source-console)' }); [Console]::Write($active.Count)",
    ],
    { AIJOB_OLD_WORKSPACE: legacy.directory },
  );
  if (Number(output.trim()) > 0)
    throw Error(
      "旧工作区服务仍在运行，请先关闭它的 API 和后台任务，再重新迁入；资料库可以保持启动。",
    );
  const running = await oldSql(
    runtime,
    legacy,
    "SELECT count(*) FROM task_queue.tasks WHERE status='running' AND lease_until>now()",
  );
  if (Number(running.trim()) > 0)
    throw Error("旧工作区还有执行中的任务，请等待完成并停止后台服务后再迁入。");
}
export async function createLegacyBackup(runtime, legacy, directory, ownerId, writeProtected) {
  if (!legacy.owners.some((o) => o.id === ownerId)) throw Error("请选择仍有效的原账户。");
  await assertLegacyStopped(runtime, legacy);
  await mkdir(path.join(directory, ".data"), { recursive: true });
  const dump = path.join(directory, "aijob.dump");
  await runtime.command(
    path.join(runtime.pg, "pg_dump.exe"),
    ["-Fc", "-f", dump],
    pgEnvironment(legacy.url),
  );
  // Personal originals, documents, artifacts and submitted files are encrypted in PG.
  // Copy the retained public evidence/configuration, not build caches and old test runs.
  for (const name of [
    "access-policy",
    "browser-imports",
    "source-leads",
    "source-refresh.local.json",
    "opportunity-discovery.local.json",
    "ai-provider.local.json",
  ]) {
    const source = path.join(legacy.directory, ".data", name);
    if (await exists(source))
      await cp(source, path.join(directory, ".data", name), { recursive: true });
  }
  if (await exists(legacy.snapshotDirectory))
    await cp(legacy.snapshotDirectory, path.join(directory, ".data/job-snapshots"), {
      recursive: true,
    });
  await cp(path.join(legacy.directory, "config"), path.join(directory, "config"), {
    recursive: true,
  });
  await writeProtected(path.join(directory, "key.dpapi"), {
    masterKey: legacy.masterKey,
    legacyOwnerId: ownerId,
  });
  await writeFile(
    path.join(directory, "aijob-backup.json"),
    JSON.stringify(
      {
        version: 1,
        sha256: createHash("sha256")
          .update(await readFile(dump))
          .digest("hex"),
        createdAt: new Date().toISOString(),
        keyFormat: "windows-dpapi-current-user",
        origin: "legacy-workspace",
      },
      null,
      2,
    ),
  );
  return directory;
}
export async function bindRestoredOwner(candidate, ownerId) {
  if (!/^[a-f0-9-]{36}$/i.test(ownerId)) throw Error("INVALID_MIGRATION_OWNER");
  const credential = randomBytes(32).toString("base64url"),
    hash = createHash("sha256").update(credential).digest("hex");
  const bound = await candidate.pgCommand("psql", [
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-At",
    "-c",
    `INSERT INTO identity.device_bindings(owner_id,owner_epoch,credential_hash) SELECT o.id,o.epoch,'${hash}' FROM identity.owners o WHERE o.id='${ownerId}'::uuid AND ${activeOwner} RETURNING owner_id`,
  ]);
  if (bound.trim().split(/\r?\n/)[0] !== ownerId) throw Error("原账户已失效，未切换工作区。");
  candidate.secret.deviceCredential = credential;
  await candidate.writeSecret(candidate.secret);
}
