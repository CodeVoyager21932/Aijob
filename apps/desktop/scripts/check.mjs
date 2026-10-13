import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

for (const dir of ["src", "scripts"])
  for (const file of readdirSync(dir))
    if (/\.(mjs|cjs)$/.test(file))
      execFileSync(process.execPath, ["--check", `${dir}/${file}`], { stdio: "inherit" });
