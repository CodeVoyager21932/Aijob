import { fork, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

const exists = async (p) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};
export const atomicJson = async (file, value) => {
  const temporary = file + ".tmp";
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, file);
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function portAvailable(port) {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const actual = server.address().port;
      server.close(() => resolve(actual));
    });
  });
}
export class LocalRuntime {
  children = new Map();
  stopping = false;
  state = { phase: "starting", message: "正在准备本地工作区", workers: {} };
  constructor({ resourceRoot, dataRoot, readSecret, writeSecret }) {
    Object.assign(this, { resourceRoot, dataRoot, readSecret, writeSecret });
    this.pg = path.join(resourceRoot, "postgresql", "bin");
    this.pgData = path.join(dataRoot, "postgres");
    this.node = path.join(resourceRoot, "node", "node.exe");
  }
  phase(phase, message) {
    this.state = { ...this.state, phase, message };
  }
  async command(exe, args, environment = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(exe, args, {
        windowsHide: true,
        cwd: this.dataRoot,
        env: { ...process.env, ...environment },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "",
        error = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        error += chunk;
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve(output)
          : reject(new Error(`${path.basename(exe)} failed (${code}): ${error.slice(-700)}`)),
      );
    });
  }
  pgCommand(name, args) {
    return this.command(path.join(this.pg, name + ".exe"), args, {
      PGPASSWORD: this.secret.postgres,
      PGHOST: "127.0.0.1",
      PGPORT: String(this.settings.pgPort),
      PGUSER: "aijob_admin",
      PGDATABASE: "aijob",
      PGCLIENTENCODING: "UTF8",
    });
  }
  url(login) {
    const password = login === "aijob_admin" ? this.secret.postgres : this.secret.roles[login];
    return `postgresql://${login}:${password}@127.0.0.1:${this.settings.pgPort}/aijob`;
  }
  environment(role) {
    const database =
      role === "prepare"
        ? "aijob_admin"
        : role === "sources"
          ? "desktop_ops"
          : role === "web"
            ? "desktop_web"
            : role === "collector"
              ? "desktop_collector"
              : "desktop_match";
    const fonts = path.join(this.resourceRoot, "apps/web/public/fonts");
    return {
      APP_ENV: "local",
      HOST: "127.0.0.1",
      PORT: String(this.settings.apiPort),
      DATABASE_URL: this.url(database),
      RESUME_ENCRYPTION_KEY: this.secret.masterKey,
      AIJOB_ROLE_PASSWORDS: role === "prepare" ? JSON.stringify(this.secret.roles) : "",
      AIJOB_DATA_ROOT: this.dataRoot,
      AIJOB_RESOURCE_ROOT: this.resourceRoot,
      AIJOB_SOURCE_CONFIG_DIR: path.join(this.dataRoot, "config/sources"),
      AIJOB_WEB_DIST: path.join(this.resourceRoot, "apps/web/dist"),
      ENABLE_SOURCE_PROBE: "true",
      ENABLE_LOCAL_MVP: "true",
      ENABLE_INTERNAL_PREVIEW: "true",
      RESUME_PARSER_MODE: "process",
      COLLECTOR_BROWSER_EXECUTABLE: path.join(
        this.resourceRoot,
        "chromium/chrome-win64/chrome.exe",
      ),
      PDF_BROWSER_EXECUTABLE: path.join(this.resourceRoot, "chromium/chrome-win64/chrome.exe"),
      PDF_FONT_PATH: path.join(fonts, "AijobCJK.woff2"),
      PDF_SERIF_FONT_PATH: path.join(fonts, "AijobSerifCJK.woff2"),
      AIJOB_RESUME_FONT_DIR: fonts,
      ACCEPTED_ORIGINS: this.origin,
      LOG_LEVEL: "info",
    };
  }
  child(role, extra = {}) {
    const child = fork(path.join(this.resourceRoot, "apps/platform/dist/runtime-child.js"), [], {
      execPath: this.node,
      execArgv: [],
      cwd: this.dataRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: {
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        LOCALAPPDATA: process.env.LOCALAPPDATA,
        PATH: path.dirname(this.node),
        NODE_ENV: "production",
      },
    });
    const log = createWriteStream(path.join(this.dataRoot, "logs", role + ".log"), { flags: "a" });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.once("exit", () => log.end());
    child.send({ type: "initialize", role, environment: { ...this.environment(role), ...extra } });
    return child;
  }
  async once(role, event, extra = {}) {
    const child = this.child(role, extra);
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        child.kill();
        reject(Error("RUNTIME_COMMAND_TIMEOUT"));
      }, 120000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("message", (message) => {
        if (message.type === event) {
          settled = true;
          clearTimeout(timeout);
          message.error ? reject(Error(message.error)) : resolve(message.result ?? message);
        } else if (message.type === "failed") {
          settled = true;
          clearTimeout(timeout);
          reject(Error(message.code));
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        if (!settled) reject(Error(`RUNTIME_COMMAND_FAILED:${role}:${code}`));
      });
    });
  }
  startDatabaseOnly() {
    return this.start({ databaseOnly: true });
  }
  async start({ databaseOnly = false, restore = null, startServices = true } = {}) {
    await mkdir(this.dataRoot, { recursive: true });
    for (const dir of ["logs", "backups", "config/sources", ".data"])
      await mkdir(path.join(this.dataRoot, dir), { recursive: true });
    const settingsPath = path.join(this.dataRoot, "runtime.json");
    if (await exists(settingsPath))
      this.settings = JSON.parse(await readFile(settingsPath, "utf8"));
    else {
      this.settings = {
        version: 1,
        apiPort: await portAvailable(0),
        pgPort: await portAvailable(0),
        trayExplained: false,
      };
      await atomicJson(settingsPath, this.settings);
    }
    // An occupied persisted origin is a real startup error; never silently change it.
    await portAvailable(this.settings.apiPort);
    this.origin = `http://127.0.0.1:${this.settings.apiPort}`;
    this.secret = await this.readSecret();
    const initialized = await exists(path.join(this.pgData, "PG_VERSION"));
    if (!this.secret) {
      if (initialized) throw Error("LOCAL_CREDENTIALS_MISSING");
      this.secret = {
        postgres: randomBytes(32).toString("hex"),
        masterKey: randomBytes(32).toString("hex"),
        roles: Object.fromEntries(
          ["desktop_web", "desktop_collector", "desktop_match", "desktop_ops"].map((r) => [
            r,
            randomBytes(32).toString("hex"),
          ]),
        ),
      };
      await this.writeSecret(this.secret);
    }
    this.phase("database", "正在启动本地资料库");
    if (!initialized) {
      if (await exists(this.pgData)) throw Error("DATABASE_INITIALIZATION_INCOMPLETE");
      const passwordFile = path.join(this.dataRoot, ".init-password-" + randomUUID());
      try {
        await writeFile(passwordFile, this.secret.postgres, { mode: 0o600, flag: "wx" });
        await this.command(path.join(this.pg, "initdb.exe"), [
          "-D",
          this.pgData,
          "-U",
          "aijob_admin",
          "--encoding=UTF8",
          "--locale=C",
          "--auth-host=scram-sha-256",
          "--auth-local=scram-sha-256",
          "--pwfile=" + passwordFile,
        ]);
      } finally {
        await rm(passwordFile, { force: true });
      }
      await writeFile(
        path.join(this.pgData, "postgresql.auto.conf"),
        `listen_addresses = '127.0.0.1'\nport = ${this.settings.pgPort}\nmax_connections = 60\nshared_buffers = '64MB'\n`,
      );
    }
    let running = false;
    try {
      await this.pgCommand("pg_ctl", ["status", "-D", this.pgData]);
      running = true;
    } catch {}
    if (!running) {
      await portAvailable(this.settings.pgPort);
      await this.pgCommand("pg_ctl", [
        "start",
        "-D",
        this.pgData,
        "-l",
        path.join(this.dataRoot, "logs/postgresql.log"),
        "-w",
        "-t",
        "40",
      ]);
    }
    const actualDirectory = (
      await this.pgCommand("psql", ["-d", "postgres", "-At", "-c", "SHOW data_directory"])
    ).trim();
    if (path.resolve(actualDirectory).toLowerCase() !== path.resolve(this.pgData).toLowerCase())
      throw Error("DATABASE_DIRECTORY_MISMATCH");
    this.ownsPostgres = true;
    if (!initialized) await this.pgCommand("createdb", ["aijob"]);
    if (databaseOnly) return;
    if (restore) {
      if (initialized) throw Error("RESTORE_REQUIRES_NEW_DATABASE");
      this.secret.masterKey = restore.masterKey;
      this.secret.deviceCredential = restore.deviceCredential;
      await this.writeSecret(this.secret);
      await this.once("prepare", "prepared", { AIJOB_PREPARE_ROLES_ONLY: "1" });
      await this.pgCommand("pg_restore", [
        "--clean",
        "--if-exists",
        "--no-owner",
        "--exit-on-error",
        "-d",
        "aijob",
        restore.dump,
      ]);
    }
    const manifest = JSON.parse(
      await readFile(path.join(this.resourceRoot, "runtime-manifest.json"), "utf8"),
    );
    let previous = "";
    try {
      previous = (
        await this.pgCommand("psql", [
          "-At",
          "-c",
          "SELECT name FROM kysely_migration ORDER BY name DESC LIMIT 1",
        ])
      ).trim();
    } catch (error) {
      if (initialized) throw error;
    }
    if (previous && previous !== manifest.latestMigration && !restore) {
      this.phase("backup", "升级前正在保留一次资料备份");
      await this.backupDatabase("before-" + manifest.latestMigration);
    }
    this.phase("migrating", "正在检查资料版本");
    await this.once("prepare", "prepared");
    if (!startServices) return;
    this.phase("services", "正在启动求职工作区");
    await this.startWeb();
    this.startWorker("match");
    this.startWorker("collector");
    this.phase("ready", "工作区已就绪");
    return this.origin;
  }
  async startWeb() {
    const child = this.child("web");
    this.children.set("web", child);
    await new Promise((resolve, reject) => {
      // A first installed launch can exceed 45 seconds while Windows loads the bundled modules.
      const timeout = setTimeout(() => reject(Error("WEB_START_TIMEOUT")), 120000);
      child.on("message", (m) => {
        if (m.type === "ready") {
          clearTimeout(timeout);
          resolve();
        } else if (m.type === "failed") {
          clearTimeout(timeout);
          reject(Error(m.code));
        }
      });
      child.once("exit", () => {
        clearTimeout(timeout);
        reject(Error("WEB_START_FAILED"));
      });
    });
    child.once("exit", () => {
      if (!this.stopping) this.phase("failed", "工作区服务停止，请完全退出后重新打开。");
    });
  }
  startWorker(role, attempt = 0) {
    if (this.stopping) return;
    const child = this.child(role);
    this.children.set(role, child);
    this.state.workers[role] = "running";
    child.once("exit", () => {
      if (this.stopping) return;
      this.state.workers[role] = "stopped";
      if (attempt < 3) setTimeout(() => this.startWorker(role, attempt + 1), 2000 * (attempt + 1));
      else this.phase("degraded", "后台任务连续启动失败。可继续编辑，查看日志后重启应用。");
    });
  }
  identity(input) {
    const child = this.children.get("web"),
      id = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.off("message", listener);
        reject(Error("IDENTITY_TIMEOUT"));
      }, 15000);
      const listener = (m) => {
        if (m.type === "identity" && m.id === id) {
          clearTimeout(timeout);
          child.off("message", listener);
          m.error ? reject(Error(m.error)) : resolve(m.result);
        }
      };
      child.on("message", listener);
      child.send({ type: "identity", id, ...input });
    });
  }
  sources(selection) {
    return this.once(
      "sources",
      "sources",
      selection ? { AIJOB_SOURCE_SELECTION: JSON.stringify(selection) } : {},
    );
  }
  async backupDatabase(label = "manual") {
    const target = path.join(
      this.dataRoot,
      "backups",
      `${label}-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`,
    );
    await this.pgCommand("pg_dump", ["-Fc", "-f", target]);
    return target;
  }
  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    this.phase("stopping", "正在保存状态并停止后台任务");
    const stopChild = async (child) => {
      if (child.exitCode !== null) return;
      child.send({ type: "shutdown" });
      for (let i = 0; i < 100 && child.exitCode === null; i++) await delay(100);
      if (child.exitCode === null) child.kill();
    };
    await Promise.all(
      ["collector", "match"]
        .map((role) => this.children.get(role))
        .filter(Boolean)
        .map(stopChild),
    );
    if (this.children.get("web")) await stopChild(this.children.get("web"));
    if (this.ownsPostgres)
      await this.pgCommand("pg_ctl", ["stop", "-D", this.pgData, "-m", "fast", "-w", "-t", "30"]);
    this.phase("stopped", "已停止");
  }
}
