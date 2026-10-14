/** Thin Windows launcher for the existing checkout; never initializes or migrates a database. */
import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
const stateDirectory = resolve(root, ".data/local-workspace");
const statePath = resolve(stateDirectory, "processes.json");
export const roles = ["api", "match", "collector", "web"];
const normalize = (value) => String(value).replaceAll("\\", "/").toLowerCase();

export function identifyRoles(commandLine, workspace) {
  const command = normalize(commandLine);
  if (!command.includes(`${normalize(workspace)}/`)) return [];
  if (/\bsrc\/dev\.(ts|js)(?:[\s"]|$)/.test(command)) return ["api", "match", "collector"];
  if (/\bsrc\/server\.(ts|js)(?:[\s"]|$)/.test(command)) return ["api"];
  if (/\bsrc\/match-worker\.(ts|js)(?:[\s"]|$)/.test(command)) return ["match"];
  if (/\bsrc\/collector-worker\.(ts|js)(?:[\s"]|$)/.test(command)) return ["collector"];
  if (/\/vite\/bin\/vite\.js(?:[\s"]|$)/.test(command)) return ["web"];
  return [];
}

export function missingRoles(snapshot) {
  for (const port of snapshot.ports) {
    if (!snapshot.processes.some((process) => process.pid === port.pid && process.roles.length)) {
      throw new Error(`端口 ${port.port} 被其他进程占用；请先处理冲突，不会覆盖或结束该进程。`);
    }
  }
  return roles.filter(
    (role) => !snapshot.processes.some((process) => process.roles.includes(role)),
  );
}

export function ownedProcesses(records, processes) {
  return records.filter((record) =>
    processes.some(
      (process) =>
        process.pid === record.pid &&
        process.created === record.created &&
        process.roles.includes(record.role),
    ),
  );
}

export function acquireOperationLock(lockPath, probeProcess = (pid) => process.kill(pid, 0)) {
  mkdirSync(dirname(lockPath), { recursive: true });
  if (existsSync(lockPath)) {
    const ownerPid = Number(readFileSync(lockPath, "utf8"));
    if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0)
      throw new Error("本机启动锁无效，请检查 .data/local-workspace/operation.lock。");
    try {
      probeProcess(ownerPid);
    } catch (error) {
      if (error.code === "ESRCH") unlinkSync(lockPath);
      else throw error;
    }
  }
  try {
    writeFileSync(lockPath, String(process.pid), { flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error("另一项启动/停止操作仍在执行，请等待完成后查看 local:status。");
    throw error;
  }
  return () => unlinkSync(lockPath);
}

function powershell(command) {
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).replace(/^\uFEFF/, "");
}

function inventory() {
  const data = JSON.parse(
    powershell(`
    $ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new();
    $processes=@(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | ForEach-Object {
      @{pid=[int]$_.ProcessId; parent=[int]$_.ParentProcessId; created=$_.CreationDate.ToUniversalTime().ToString('o'); command=$_.CommandLine}
    });
    $ports=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(3000,5173) } | ForEach-Object { @{port=[int]$_.LocalPort;pid=[int]$_.OwningProcess} });
    @{processes=$processes;ports=$ports} | ConvertTo-Json -Depth 4 -Compress
  `),
  );
  data.processes = data.processes.map(({ command, ...process }) => ({
    ...process,
    roles: identifyRoles(command, root),
  }));
  return data;
}

function readState() {
  if (!existsSync(statePath)) return [];
  return JSON.parse(readFileSync(statePath, "utf8"));
}
function saveState(records) {
  mkdirSync(stateDirectory, { recursive: true });
  writeFileSync(statePath, JSON.stringify(records, null, 2));
}

function databaseState() {
  try {
    const container = JSON.parse(
      execFileSync("docker", ["inspect", "aijob-recovered-postgres"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    )[0];
    const mapped = container.HostConfig.PortBindings["5432/tcp"]?.some(
      (binding) => binding.HostPort === "55439",
    );
    if (!mapped) return "configuration-mismatch";
    return container.State.Running ? "running" : "stopped";
  } catch {
    return "unavailable";
  }
}

function checkWorkspace() {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath))
    throw new Error("缺少当前工作区 .env；请恢复原配置，不会自动创建空库或生成密钥。");
  const config = readFileSync(envPath, "utf8");
  const value = (key) =>
    process.env[key] ||
    config.match(new RegExp(`^\\s*${key}\\s*=\\s*["']?([^\\r\\n"']+)`, "m"))?.[1]?.trim();
  for (const key of [
    "DATABASE_URL",
    "WEB_API_DATABASE_URL",
    "MATCH_DATABASE_URL",
    "COLLECTOR_DATABASE_URL",
  ]) {
    const selected = value(key) || value("DATABASE_URL");
    let url;
    try {
      url = new URL(selected);
    } catch {
      throw new Error("工作区数据库地址无法解析，请核对原配置。");
    }
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      url.port !== "55439" ||
      url.pathname !== "/aijob"
    ) {
      throw new Error("local:start 仅复用已登记的 55439/aijob 业务库；当前配置不匹配，不会切库。");
    }
  }
  if (value("PORT") && value("PORT") !== "3000")
    throw new Error("当前 API 端口与本机登记的 3000 不一致，请核对运行手册。");
  if (process.env.AIJOB_DATA_ROOT && resolve(process.env.AIJOB_DATA_ROOT) !== root)
    throw new Error("AIJOB_DATA_ROOT 指向其他工作区；请在当前工作区环境启动。");
  if (existsSync(resolve(root, ".data/desktop-migration.json")))
    throw new Error("存在桌面迁入标记，请先核对运行手册中的资料位置。");
  for (const entry of [
    "packages/resume-core/dist/index.js",
    "packages/resume-renderer/dist/isolated.mjs",
  ]) {
    if (!existsSync(resolve(root, entry)))
      throw new Error("缺少运行依赖构建，请先执行 pnpm build:runtime；不会自动重建整个项目。");
  }
}

function launch(role) {
  const requirePlatform = createRequire(resolve(root, "apps/platform/package.json"));
  const requireWeb = createRequire(resolve(root, "apps/web/package.json"));
  const script = { api: "server", match: "match-worker", collector: "collector-worker" }[role];
  const args =
    role === "web"
      ? [
          resolve(requireWeb.resolve("vite/package.json"), "../bin/vite.js"),
          "--host",
          "127.0.0.1",
          "--port",
          "5173",
        ]
      : [requirePlatform.resolve("tsx/cli"), "watch", `src/${script}.ts`];
  mkdirSync(stateDirectory, { recursive: true });
  const output = openSync(resolve(stateDirectory, `${role}.log`), "a");
  try {
    const child = spawn(process.execPath, args, {
      cwd: resolve(root, role === "web" ? "apps/web" : "apps/platform"),
      env: { ...process.env, WEB_API_ORIGIN: "http://127.0.0.1:3000" },
      detached: true,
      windowsHide: true,
      stdio: ["ignore", output, output],
    });
    child.unref();
    return child.pid;
  } finally {
    closeSync(output);
  }
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));
async function probe(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

async function main(action) {
  if (process.platform !== "win32")
    throw new Error(
      "local:* 是当前 Windows 工作区的薄入口；其他环境使用现有 pnpm dev 与部署手册。",
    );
  if (!["status", "start", "stop"].includes(action))
    throw new Error("使用 pnpm local:status / local:start / local:stop。");
  let snapshot = inventory();
  const owned = ownedProcesses(readState(), snapshot.processes);
  if (action === "start") {
    checkWorkspace();
    const missing = missingRoles(snapshot);
    const database = databaseState();
    if (!["running", "stopped"].includes(database))
      throw new Error(
        "Docker 或已登记业务容器不可用；请打开 Docker Desktop 并核对容器，不会新建或恢复数据库。",
      );
    if (database === "stopped")
      execFileSync("docker", ["start", "aijob-recovered-postgres"], {
        windowsHide: true,
        timeout: 30_000,
        stdio: "ignore",
      });
    let databaseReady = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        execFileSync("docker", ["exec", "aijob-recovered-postgres", "pg_isready", "-q"], {
          windowsHide: true,
          timeout: 3000,
          stdio: "ignore",
        });
        databaseReady = true;
        break;
      } catch {
        await wait(500);
      }
    }
    if (!databaseReady)
      throw new Error("业务容器尚未就绪；没有启动应用或执行迁移，请检查 Docker 状态。");
    // Record each process immediately, so a later failure remains recoverable with local:stop.
    for (const role of missing) {
      const pid = launch(role);
      await wait(500);
      snapshot = inventory();
      const process = snapshot.processes.find((item) => item.pid === pid);
      if (!process)
        throw new Error(
          `${role} 启动后退出；查看 .data/local-workspace/${role}.log。已启动进程可用 local:stop 停止。`,
        );
      owned.push({ role, pid, created: process.created });
      saveState(owned);
    }
    console.log(
      missing.length
        ? `已补启：${missing.join("、")}。`
        : "现有应用进程已运行，已复用；没有重复启动 worker。",
    );
  } else if (action === "stop") {
    for (const record of owned) {
      // A PID alone is insufficient: verify creation time again immediately before stopping its tree.
      const live = ownedProcesses([record], inventory().processes);
      if (!live.length) continue;
      const expected = record.created.replaceAll("'", "''");
      powershell(
        `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${record.pid}"; if ($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq '${expected}') { taskkill /PID ${record.pid} /T /F | Out-Null }`,
      );
    }
    saveState([]);
    console.log(`已停止本入口管理的 ${owned.length} 个进程树；复用的外部进程和数据库保持原状态。`);
  }
  snapshot = inventory();
  let healthy = await Promise.all([
    probe("http://127.0.0.1:3000/health/ready"),
    probe("http://127.0.0.1:5173/"),
  ]);
  // A cold Windows/tsx startup can take about a minute before the API starts listening.
  const readinessDeadline = Date.now() + 60_000;
  if (action === "start" && !healthy.every(Boolean))
    console.log("正在等待 API/Web 就绪，最多再等待 60 秒；无需重复启动。");
  while (action === "start" && !healthy.every(Boolean) && Date.now() < readinessDeadline) {
    await wait(1000);
    healthy = await Promise.all([
      probe("http://127.0.0.1:3000/health/ready"),
      probe("http://127.0.0.1:5173/"),
    ]);
  }
  console.log(
    JSON.stringify(
      {
        database: databaseState(),
        configPresent: existsSync(resolve(root, ".env")),
        services: Object.fromEntries(
          roles.map((role) => [
            role,
            {
              running: snapshot.processes.some((process) => process.roles.includes(role)),
              ...(role === "api"
                ? { ready: healthy[0] }
                : role === "web"
                  ? { ready: healthy[1] }
                  : {}),
            },
          ]),
        ),
        logs: ".data/local-workspace/<role>.log",
      },
      null,
      2,
    ),
  );
  if (action === "start" && !healthy.every(Boolean))
    throw new Error(
      "进程已启动，但 API/Web 尚未就绪；请查看对应本机日志，不要重复启动另一套进程。",
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2] || "status";
  const lockPath = resolve(stateDirectory, "operation.lock");
  let releaseLock;
  try {
    if (["start", "stop"].includes(action)) releaseLock = acquireOperationLock(lockPath);
    await main(action);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "本机启动失败，请检查运行手册。");
    process.exitCode = 1;
  } finally {
    releaseLock?.();
  }
}
