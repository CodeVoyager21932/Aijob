import type { ResearchOfficialTarget } from "./types";

const researchOrigin = "https://local.aijob.invalid";

function matchesPathPrefix(pathname: string, pathPrefix: string): boolean {
  if (!pathPrefix.startsWith("/")) return false;
  if (pathPrefix === "/") return true;
  if (pathPrefix.endsWith("/")) return pathname.startsWith(pathPrefix);
  return pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`);
}

export function safeResearchSearchPath(value: unknown): string {
  if (typeof value !== "string") return "/research/jobs";

  try {
    const parsed = new URL(value, researchOrigin);
    if (parsed.origin === researchOrigin && parsed.pathname === "/research/jobs") {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Invalid navigation state falls back to the research list.
  }

  return "/research/jobs";
}

export function safeOfficialUrl(value: string, target: ResearchOfficialTarget): URL | null {
  try {
    const parsed = new URL(value);
    const port = Number(parsed.port || "443");
    const allowedQueryParameters = new Set(target.allowedQueryParameters);
    const queryIsAllowed = [...parsed.searchParams.keys()].every((key) =>
      allowedQueryParameters.has(key),
    );
    const pathIsAllowed = matchesPathPrefix(parsed.pathname, target.pathPrefix);

    if (
      parsed.protocol !== `${target.scheme}:` ||
      parsed.hostname.toLowerCase() !== target.host.toLowerCase() ||
      port !== target.port ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      !pathIsAllowed ||
      !queryIsAllowed
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
