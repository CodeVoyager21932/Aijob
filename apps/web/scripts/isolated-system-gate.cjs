// Offline system Gate. Requires an already running, dedicated test PostgreSQL instance.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { Client } = require("../../../packages/database/node_modules/pg");

const root = path.resolve(__dirname, "../../..");
const runtime = process.env.AIJOB_GATE_RUNTIME_ROOT;
assert(runtime && path.isAbsolute(runtime), "AIJOB_GATE_RUNTIME_ROOT must be an absolute scratch directory");
const adminUrl = new URL(process.env.AIJOB_TEST_DATABASE_URL);
assert(["localhost", "127.0.0.1"].includes(adminUrl.hostname) && /^\/aijob_.*test/.test(adminUrl.pathname), "isolated loopback database required");
const stamp = Date.now();
const fullName = `aijob_ux_full_test_${stamp}`;
const emptyName = `aijob_ux_empty_test_${stamp}`;
const dbUrl = name => { const url = new URL(adminUrl); url.pathname = `/${name}`; return url.toString(); };
const children = [];
fs.mkdirSync(runtime, {recursive: true});

function start(label, args, cwd, env) {
  const output = fs.openSync(path.join(runtime, `${label}.log`), "w");
  const child = spawn(process.execPath, args, {cwd, windowsHide: true, env: {...process.env, ...env}, stdio: ["ignore", output, output]});
  fs.closeSync(output);
  children.push(child);
  return child;
}
async function ready(port, child) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server ${port} exited; inspect runtime log`);
    try { await fetch(`http://127.0.0.1:${port}/`, {signal: AbortSignal.timeout(1000)}); return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`server ${port} did not become ready`);
}
async function command(script, env) {
  const child = spawn(process.execPath, [path.join(__dirname, script)], {cwd: root, windowsHide: true, env: {...process.env, ...env}, stdio: "inherit"});
  children.push(child);
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  assert.equal(code, 0, `${script} failed`);
}

async function main() {
  for (const port of [3000, 3001, 5173, 5174, 5175]) {
    await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", () => reject(new Error(`Gate port ${port} is already occupied; stop the prior isolated run first`)));
      server.listen(port, "127.0.0.1", () => server.close(resolve));
    });
  }
  const admin = new Client({connectionString: adminUrl.toString()});
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${fullName}"`);
    await admin.query(`CREATE DATABASE "${emptyName}"`);
    fs.writeFileSync(path.join(runtime, "manifest.json"), JSON.stringify({fullName, emptyName, port: adminUrl.port, createdAt: new Date().toISOString()}, null, 2));
    const platform = path.join(root, "apps/platform");
    const web = path.join(root, "apps/web");
    for (const [label, port, name] of [["full-api", 3000, fullName], ["empty-api", 3001, emptyName]]) {
      const child = start(label, ["--import", "tsx", "scripts/isolated-test-server.ts"], platform, {OS1_DATABASE_URL: dbUrl(name), OS1_PLATFORM_PORT: String(port), OS1_RUNTIME_ROOT: runtime});
      await ready(port, child);
    }
    for (const [label, port, api, flag] of [["full-web", 5173, 3000, "true"], ["empty-web", 5175, 3001, "true"], ["flag-off-web", 5174, 3000, "false"]]) {
      const child = start(label, ["node_modules/vite/bin/vite.js", "--strictPort", "--port", String(port)], web, {WEB_API_ORIGIN: `http://127.0.0.1:${api}`, VITE_CAREER_OS_V2: flag});
      await ready(port, child);
    }
    const env = {OS7_FULL_DATABASE_URL: dbUrl(fullName), OS7_EMPTY_DATABASE_URL: dbUrl(emptyName), OS7_WORKSPACE_ROOT: root, OS7_RUNTIME_ROOT: runtime};
    await command("os7-browser-gate.cjs", env);
    if (process.env.AIJOB_FIDELITY_BROWSER === "true") await command("job-fidelity-browser-gate.cjs", env);
  } finally {
    for (const child of children.reverse()) if (child.exitCode === null) child.kill();
    // Preserve only test evidence on disk; these uniquely named databases are disposable.
    await admin.query(`DROP DATABASE IF EXISTS "${fullName}" WITH (FORCE)`);
    await admin.query(`DROP DATABASE IF EXISTS "${emptyName}" WITH (FORCE)`);
    await admin.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
