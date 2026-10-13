import { spawn } from "node:child_process";
import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
const prefix = "AIJOB-DPAPI-1\n";
async function dpapi(operation, input) {
  const script = await readFile(path.join(import.meta.dirname, "windows-dpapi.ps1"), "utf8");
  if (!["protect", "unprotect"].includes(operation)) throw Error("INVALID_PROTECTION_OPERATION");
  return new Promise((resolve, reject) => {
    const child = spawn(
      path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-Command", `& { ${script} } -Operation ${operation}`],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("WINDOWS_DPAPI_TIMEOUT"));
    }, 20000);
    child.stdout.on("data", (data) => {
      output += data;
      if (output.length > 1024 * 1024) {
        child.kill();
        reject(Error("WINDOWS_DPAPI_LIMIT"));
      }
    });
    child.stderr.resume();
    child.once("error", () => {
      clearTimeout(timer);
      reject(Error("WINDOWS_DPAPI_UNAVAILABLE"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(Buffer.from(output.trim(), "base64"))
        : reject(Error("WINDOWS_DPAPI_FAILED"));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input.toString("base64"));
  });
}
export async function readProtectedFile(file, legacyDecode) {
  let bytes;
  try {
    bytes = await readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (bytes.subarray(0, prefix.length).toString() === prefix)
    return JSON.parse(
      (
        await dpapi("unprotect", Buffer.from(bytes.subarray(prefix.length).toString(), "base64"))
      ).toString(),
    );
  if (legacyDecode) return JSON.parse(legacyDecode(bytes));
  throw Error("LOCAL_CREDENTIAL_FORMAT_UNSUPPORTED");
}
export async function writeProtectedFile(file, value) {
  const ciphertext = await dpapi("protect", Buffer.from(JSON.stringify(value))),
    temporary = file + ".tmp";
  await writeFile(temporary, prefix + ciphertext.toString("base64"), { mode: 0o600 });
  await rename(temporary, file);
}
