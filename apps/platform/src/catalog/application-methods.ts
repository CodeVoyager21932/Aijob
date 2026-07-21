import type { ApplicationMethod } from "@aijob/contracts";
import type { JsonValue } from "@aijob/database";

function asObject(value: JsonValue): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

export function approvedCompanyEmail(
  structuredFields: JsonValue,
  officialDomain: string,
): Extract<ApplicationMethod, { type: "company_email" }> | null {
  const structured = asObject(structuredFields);
  const email =
    typeof structured.applicationEmail === "string"
      ? structured.applicationEmail.normalize("NFKC").trim().toLowerCase()
      : "";
  const sourceText =
    typeof structured.applicationEmailSourceText === "string"
      ? structured.applicationEmailSourceText.trim()
      : "";
  const domain = email.split("@")[1];
  const normalizedOfficialDomain = officialDomain.toLowerCase().replace(/^www\./, "");
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !domain ||
    !sourceText ||
    !sourceText.normalize("NFKC").toLowerCase().includes(email) ||
    (domain !== normalizedOfficialDomain && !domain.endsWith(`.${normalizedOfficialDomain}`))
  ) {
    return null;
  }
  return { type: "company_email", email, sourceText };
}
