import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  shell,
  Tray,
} from "electron";
import { bindRestoredOwner, createLegacyBackup, inspectLegacy } from "./legacy-import.mjs";
import { readProtectedFile, writeProtectedFile } from "./protected-store.mjs";
import { atomicJson, LocalRuntime } from "./runtime.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.AIJOB_DESKTOP_DATA_ROOT ?? path.join(process.env.LOCALAPPDATA, "Aijob");
const resourceRoot = app.isPackaged
  ? path.join(process.resourcesPath, "runtime")
  : path.resolve(here, "../../../.data/desktop-bundle-20261013");
let window,
  tray,
  runtime,
  legacySelection,
  quitting = false;
const exists = async (p) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};
app.setPath("userData", path.join(root, "electron-profile"));
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void app
    .whenReady()
    .then(launch)
    .catch((error) => {
      console.error("DESKTOP_START_FAILED", error.message);
      app.quit();
    });
}
async function readProtected(file) {
  return readProtectedFile(file, (bytes) => safeStorage.decryptString(bytes));
}
async function writeProtected(file, value) {
  await writeProtectedFile(file, value);
}
function newRuntime(dataRoot) {
  const secretFile = path.join(dataRoot, "credentials.dpapi");
  return new LocalRuntime({
    resourceRoot,
    dataRoot,
    readSecret: () => readProtected(secretFile),
    writeSecret: (value) => writeProtected(secretFile, value),
  });
}
function trusted(event) {
  if (
    event.sender !== window?.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    new URL(event.senderFrame.url).origin !== runtime.origin
  )
    throw Error("DESKTOP_CONTEXT_REQUIRED");
}
async function restoreIdentity() {
  const cookies = await window.webContents.session.cookies.get({
    url: runtime.origin,
    name: "aijob_session",
  });
  const result = await runtime.identity({
    credential: runtime.secret.deviceCredential,
    sessionToken: cookies[0]?.value,
  });
  if (result.credential) {
    runtime.secret.deviceCredential = result.credential;
    await runtime.writeSecret(runtime.secret);
  }
  if (!result.reuse) {
    const session = result.session,
      expirationDate = new Date(session.context.sessionExpiresAt).getTime() / 1000;
    await window.webContents.session.cookies.set({
      url: runtime.origin,
      name: "aijob_session",
      value: session.sessionToken,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      expirationDate,
    });
    await window.webContents.session.cookies.set({
      url: runtime.origin,
      name: "aijob_csrf",
      value: session.csrfToken,
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      expirationDate,
    });
  }
}
async function launch() {
  if (!safeStorage.isEncryptionAvailable()) throw Error("WINDOWS_ENCRYPTION_UNAVAILABLE");
  await mkdir(root, { recursive: true });
  const activeFile = path.join(root, "active-workspace.json");
  const active = (await exists(activeFile))
    ? JSON.parse(await readFile(activeFile, "utf8")).directory
    : root;
  if (active !== root && !path.resolve(active).startsWith(path.join(root, "workspaces") + path.sep))
    throw Error("WORKSPACE_PATH_INVALID");
  runtime = newRuntime(active);
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 650,
    title: "Aijob",
    backgroundColor: "#f6f7f2",
    show: false,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  await window.loadFile(path.join(here, "starting.html"));
  if (process.env.AIJOB_DESKTOP_TEST_HIDDEN !== "1") window.show();
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (runtime.origin && !url.startsWith(runtime.origin + "/")) {
      event.preventDefault();
      if (/^https:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
    if (runtime.settings && !runtime.settings.trayExplained) {
      runtime.settings.trayExplained = true;
      void atomicJson(path.join(runtime.dataRoot, "runtime.json"), runtime.settings);
      tray?.displayBalloon({
        title: "Aijob 继续在后台运行",
        content: "关闭窗口后继续刷新已启用官网。需要停止时，在托盘选择“完全退出”。",
      });
    }
  });
  tray = new Tray(nativeImage.createFromPath(path.join(here, "icon.png")));
  tray.setToolTip("Aijob 求职工作区");
  tray.on("double-click", () => window.show());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开 Aijob", click: () => window.show() },
      {
        label: "连接与运行",
        click: () => {
          window.show();
          if (runtime.origin) void window.loadURL(runtime.origin + "/settings/ai");
        },
      },
      { type: "separator" },
      { label: "完全退出", click: () => app.quit() },
    ]),
  );
  app.on("second-instance", () => {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void runtime
      .stop()
      .catch(() => {})
      .finally(() => {
        tray.destroy();
        app.quit();
      });
  });
  ipcMain.handle("aijob:status", (event) => {
    trusted(event);
    return {
      ...runtime.state,
      autostart: app.getLoginItemSettings().openAtLogin,
      dataRoot: runtime.dataRoot,
      version: app.getVersion(),
      packaged: app.isPackaged,
    };
  });
  ipcMain.handle("aijob:sources", (event) => {
    trusted(event);
    return runtime.sources();
  });
  ipcMain.handle("aijob:select-sources", (event, selection) => {
    trusted(event);
    return runtime.sources(selection);
  });
  ipcMain.handle("aijob:startup", (event, enabled) => {
    trusted(event);
    if (typeof enabled !== "boolean") throw Error("INVALID_STARTUP_SETTING");
    app.setLoginItemSettings({ openAtLogin: enabled });
    return enabled;
  });
  ipcMain.handle("aijob:logs", (event) => {
    trusted(event);
    return shell.openPath(path.join(runtime.dataRoot, "logs"));
  });
  ipcMain.handle("aijob:quit", (event) => {
    trusted(event);
    app.quit();
  });
  ipcMain.handle("aijob:backup", async (event) => {
    trusted(event);
    const target = await dialog.showOpenDialog(window, {
      title: "选择备份保存目录",
      properties: ["openDirectory", "createDirectory"],
    });
    if (target.canceled) return { cancelled: true };
    return exportBackup(target.filePaths[0]);
  });
  ipcMain.handle("aijob:import", async (event) => {
    trusted(event);
    const selected = await dialog.showOpenDialog(window, {
      title: "选择 Aijob 完整备份文件夹",
      properties: ["openDirectory"],
    });
    if (selected.canceled) return { cancelled: true };
    return importBackup(selected.filePaths[0], activeFile);
  });
  ipcMain.handle("aijob:legacy-select", async (event) => {
    trusted(event);
    const selected = await dialog.showOpenDialog(window, {
      title: "选择原 Aijob 项目目录（包含 .env）",
      properties: ["openDirectory"],
    });
    if (selected.canceled) return null;
    legacySelection = await inspectLegacy(runtime, selected.filePaths[0]);
    return { directory: legacySelection.directory, owners: legacySelection.owners };
  });
  ipcMain.handle("aijob:legacy-import", async (event, ownerId) => {
    trusted(event);
    if (!legacySelection) throw Error("请先选择原工作区。");
    const answer = await dialog.showMessageBox(window, {
      type: "question",
      message: "备份原工作区并迁入安装版？",
      detail:
        "原数据库、文件和密钥会保留。请先停止原 API 和后台任务；恢复并绑定原账户成功后才切换。切换后原目录会标记为已迁出，避免重复刷新。",
      buttons: ["取消", "备份并迁入"],
      defaultId: 0,
      cancelId: 0,
    });
    if (answer.response !== 1) return { cancelled: true };
    const backup = path.join(root, "backups", "legacy-" + Date.now());
    await createLegacyBackup(runtime, legacySelection, backup, ownerId, writeProtected);
    return importBackup(backup, activeFile, {
      confirmed: true,
      legacyDirectory: legacySelection.directory,
    });
  });
  try {
    await runtime.start();
    await restoreIdentity();
    await window.loadURL(runtime.origin + (runtime.settings.onboarded ? "/today" : "/settings/ai"));
    runtime.settings.onboarded = true;
    await atomicJson(path.join(runtime.dataRoot, "runtime.json"), runtime.settings);
  } catch (error) {
    await showStartupFailure(error);
  }
}
async function showStartupFailure(error) {
  const code = String(error.message ?? error).replace(/postgres(?:ql)?:\/\/\S+/g, "[database]");
  if (process.env.AIJOB_DESKTOP_TEST_HIDDEN === "1") {
    console.error("DESKTOP_START_FAILED", code);
    app.quit();
    return;
  }
  const answer = await dialog.showMessageBox(window, {
    type: "error",
    title: "Aijob 启动未完成",
    message: code.includes("DEVICE_BINDING") ? "这台设备的资料绑定已失效" : "本地工作区暂未启动",
    detail: code.includes("DEVICE_BINDING")
      ? "原账户可能已删除或退出授权。可以创建新的空工作区；不会恢复已删除账户。"
      : code === "WEB_START_TIMEOUT"
        ? "后台服务在两分钟内未能启动完成。原资料保留，可打开日志查看原因，稍后重新启动。"
        : code + "\n原资料保留。可打开日志目录定位问题。",
    buttons: code.includes("DEVICE_BINDING") ? ["退出", "创建新的空工作区"] : ["退出", "打开日志"],
    defaultId: 0,
  });
  if (answer.response === 1 && code.includes("DEVICE_BINDING")) {
    delete runtime.secret.deviceCredential;
    await runtime.writeSecret(runtime.secret);
    await window.webContents.session.clearStorageData({ storages: ["cookies"] });
    await restoreIdentity();
    await window.loadURL(runtime.origin + "/settings/ai");
    return;
  }
  if (answer.response === 1) await shell.openPath(path.join(runtime.dataRoot, "logs"));
  app.quit();
}
async function exportBackup(parent) {
  const directory = path.join(
    parent,
    "Aijob-backup-" + new Date().toISOString().replace(/[:.]/g, "-"),
  );
  await mkdir(directory);
  // Pause every writer before pairing the dump and retained files.
  await runtime.stop();
  const backupRuntime = newRuntime(runtime.dataRoot);
  await backupRuntime.startDatabaseOnly();
  try {
    const dump = path.join(directory, "aijob.dump");
    await backupRuntime.pgCommand("pg_dump", ["-Fc", "-f", dump]);
    await cp(path.join(runtime.dataRoot, ".data"), path.join(directory, ".data"), {
      recursive: true,
    });
    await cp(path.join(runtime.dataRoot, "config"), path.join(directory, "config"), {
      recursive: true,
    });
    await writeProtected(path.join(directory, "key.dpapi"), {
      masterKey: runtime.secret.masterKey,
      deviceCredential: runtime.secret.deviceCredential,
    });
    await atomicJson(path.join(directory, "aijob-backup.json"), {
      version: 1,
      sha256: createHash("sha256")
        .update(await readFile(dump))
        .digest("hex"),
      createdAt: new Date().toISOString(),
      keyFormat: "windows-dpapi-current-user",
    });
  } finally {
    await backupRuntime.stop();
  }
  app.relaunch();
  app.quit();
  return { directory, restarting: true };
}
async function importBackup(directory, activeFile, options = {}) {
  const manifest = JSON.parse(await readFile(path.join(directory, "aijob-backup.json"), "utf8"));
  if (
    manifest.version !== 1 ||
    createHash("sha256")
      .update(await readFile(path.join(directory, "aijob.dump")))
      .digest("hex") !== manifest.sha256
  )
    throw Error("BACKUP_INTEGRITY_FAILED");
  const key = await readProtected(path.join(directory, "key.dpapi"));
  if (!key?.masterKey) throw Error("BACKUP_KEY_UNAVAILABLE");
  const answer = options.confirmed
    ? { response: 1 }
    : await dialog.showMessageBox(window, {
        type: "question",
        message: "导入备份并切换工作区？",
        detail:
          "将恢复到独立资料目录；成功后切换。当前资料保留，后台刷新会先停止。备份的原实例须已停止刷新，避免重复调度。",
        buttons: ["取消", "导入并切换"],
        defaultId: 0,
        cancelId: 0,
      });
  if (answer.response !== 1) return { cancelled: true };
  await runtime.stop();
  const target = path.join(root, "workspaces", "import-" + Date.now());
  await mkdir(target, { recursive: true });
  const candidate = newRuntime(target);
  try {
    await cp(path.join(directory, ".data"), path.join(target, ".data"), { recursive: true });
    await cp(path.join(directory, "config"), path.join(target, "config"), { recursive: true });
    await candidate.start({
      restore: { dump: path.join(directory, "aijob.dump"), ...key },
      startServices: false,
    });
    if (key.legacyOwnerId) await bindRestoredOwner(candidate, key.legacyOwnerId);
    await candidate.stop();
    if (options.legacyDirectory)
      await atomicJson(path.join(options.legacyDirectory, ".data/desktop-migration.json"), {
        version: 1,
        migratedAt: new Date().toISOString(),
        destination: target,
        backup: directory,
      });
    await atomicJson(activeFile, { directory: target });
    app.relaunch();
    app.quit();
    return { restarting: true };
  } catch (error) {
    await candidate.stop().catch(() => {});
    await dialog.showMessageBox(window, {
      type: "error",
      message: "导入未完成，原资料仍保留",
      detail: String(error.message),
      buttons: ["返回原工作区"],
    });
    app.relaunch();
    app.quit();
    return { failed: true };
  }
}
