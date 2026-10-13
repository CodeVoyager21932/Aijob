/** Desktop sends secrets through inherited IPC, not argv or plaintext files. */
if (!process.send) throw new Error("DESKTOP_IPC_REQUIRED");
process.once("message", async (message: unknown) => {
  const input = message as { type: string; environment: Record<string, string>; role: string };
  if (input.type !== "initialize") throw new Error("DESKTOP_INIT_REQUIRED");
  for (const [key, value] of Object.entries(input.environment)) process.env[key] = value;
  process.env.AIJOB_DESKTOP_CHILD = "1";
  try {
    if (input.role === "web") await import("./server.js");
    else if (input.role === "collector") await import("./collector-worker.js");
    else if (input.role === "match") await import("./match-worker.js");
    else if (input.role === "prepare") await import("./runtime-prepare.js");
    else if (input.role === "sources") await import("./runtime-sources.js");
    else throw new Error("DESKTOP_ROLE_INVALID");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      "DESKTOP_CHILD_FAILED",
      input.role,
      detail
        .replace(/postgres(?:ql)?:\/\/\S+/g, "[database]")
        .replace(/[a-f0-9]{64}/gi, "[secret]")
        .slice(0, 1000),
    );
    process.send?.({ type: "failed", code: "RUNTIME_START_FAILED" });
    process.exitCode = 1;
    process.disconnect?.();
  }
});
