import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { parseEnv } from "node:util";
import { resolve } from "node:path";

// Read a named deployment file only. Never load or mutate the developer's .env.
const file = process.argv[2];
if (!file) throw new Error("Usage: node infra/runtime/check-readiness.mjs <deployment-env-file>");
const env = parseEnv(await readFile(resolve(file), "utf8"));
const configured = (key) => Boolean(env[key]?.trim());
const rows = [];
const check = (capability, ready, detail) =>
  rows.push({ capability, state: ready ? "configured_not_verified" : "not_ready", detail });
check(
  "remote_environment",
  ["alpha", "production"].includes(env.APP_ENV),
  "Requires alpha or production.",
);
check(
  "identity",
  configured("IDENTITY_MASTER_KEY") && configured("ACCEPTED_ORIGINS"),
  "Real session, origin and account verification still required.",
);
check(
  "smtp",
  env.IDENTITY_EMAIL_DELIVERY_MODE === "smtp" &&
    ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"].every(configured),
  "Does not send email; real delivery has not been established by this check.",
);
check(
  "personal_encryption",
  /^[a-f0-9]{64}$/i.test(env.RESUME_ENCRYPTION_KEY ?? ""),
  "Preserve this secret independently of the database backup.",
);
check(
  "isolated_parser",
  env.RESUME_PARSER_MODE === "container" &&
    /@sha256:[a-f0-9]{64}$/i.test(env.RESUME_PARSER_CONTAINER_IMAGE ?? ""),
  "Run the actual parser as the service account before enabling upload.",
);
for (const key of ["PDF_BROWSER_EXECUTABLE", "PDF_FONT_PATH", "PDF_SERIF_FONT_PATH"]) {
  let exists = false;
  if (configured(key))
    try {
      await access(env[key], constants.R_OK);
      exists = true;
    } catch {}
  check(key, exists, "Local path check only; Chinese PDF rendering must also pass.");
}
check(
  "personal_ai",
  env.ENABLE_AI === "true" &&
    ["AI_BASE_URL", "AI_MODEL", "AI_API_KEY"].every(configured) &&
    Number(env.PERSONAL_AI_DAILY_CALLS) > 0 &&
    Number(env.PERSONAL_AI_DAILY_TOKEN_BUDGET) > 0,
  "Rules remain available. A real bounded provider call is separate evidence.",
);
check(
  "supply_automation",
  env.COLLECTOR_AUTOMATION_ENABLED === "true" && env.COLLECTOR_ISOLATION === "container",
  "Source approval and continuous observation are not inferred from environment switches.",
);
for (const key of ["WEB_API_DATABASE_URL", "MATCH_DATABASE_URL", "COLLECTOR_DATABASE_URL"]) {
  let valid = false;
  try {
    valid = ["postgres:", "postgresql:"].includes(new URL(env[key]).protocol);
  } catch {}
  check(key, valid, "Actual role membership, migrations and connectivity require separate checks.");
}
console.log(
  JSON.stringify(
    { checkedAt: new Date().toISOString(), status: "configuration_check_only", capabilities: rows },
    null,
    2,
  ),
);
process.exitCode = rows.some((row) => row.state === "not_ready") ? 2 : 0;
