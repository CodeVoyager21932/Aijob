import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

export const LOCAL_REFRESH_CONTROL_RELATIVE_PATH = ".data/source-refresh.local.json";

const LocalRefreshControlSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  updatedAt: z.string().datetime(),
});

export type LocalRefreshControl = z.infer<typeof LocalRefreshControlSchema>;

function controlPath(rootDirectory: string): string {
  return resolve(rootDirectory, LOCAL_REFRESH_CONTROL_RELATIVE_PATH);
}

export function readLocalRefreshControl(rootDirectory: string): LocalRefreshControl {
  const path = controlPath(rootDirectory);
  if (!existsSync(path)) {
    return { version: 1, enabled: false, updatedAt: new Date(0).toISOString() };
  }
  try {
    return LocalRefreshControlSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    throw new Error("LOCAL_REFRESH_CONTROL_INVALID");
  }
}

export function writeLocalRefreshControl(input: {
  rootDirectory: string;
  enabled: boolean;
  now?: Date;
}): LocalRefreshControl {
  const control = LocalRefreshControlSchema.parse({
    version: 1,
    enabled: input.enabled,
    updatedAt: (input.now ?? new Date()).toISOString(),
  });
  const path = controlPath(input.rootDirectory);
  mkdirSync(resolve(input.rootDirectory, ".data"), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(control, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return control;
}
