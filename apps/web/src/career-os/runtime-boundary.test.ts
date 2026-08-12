import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const entryFiles = [
  resolve(sourceRoot, "WorkspaceShell.tsx"),
  resolve(sourceRoot, "pages/ApplicationsPage.tsx"),
  resolve(sourceRoot, "pages/CareerOsHomePage.tsx"),
  resolve(sourceRoot, "pages/CaseWorkspacePage.tsx"),
];
const compatibilityEntry = resolve(sourceRoot, "pages/LegacyCompatibilityPage.tsx");

function resolveRelativeImport(fromFile: string, specifier: string): string | null {
  const candidate = resolve(dirname(fromFile), specifier);
  for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const file = `${candidate}${suffix}`;
    if (existsSync(file)) return file;
  }
  return null;
}

function collectRuntimeGraph(entries: string[]): Map<string, string> {
  const graph = new Map<string, string>();
  const pending = [...entries];
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || graph.has(file)) continue;
    const source = readFileSync(file, "utf8");
    graph.set(file, source);
    for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const dependency = resolveRelativeImport(file, match[1] ?? "");
      if (dependency) pending.push(dependency);
    }
  }
  return graph;
}

describe("Career OS runtime boundary", () => {
  it("does not load static Case fixtures on normal M1 routes", () => {
    const graph = collectRuntimeGraph(entryFiles);
    expect([...graph.keys()].some((file) => file.endsWith("domain.ts"))).toBe(false);
    expect([...graph.keys()].some((file) => file.endsWith("case-workspace-domain.ts"))).toBe(false);
    expect([...graph.values()].some((source) => /\bcareerCases\b/.test(source))).toBe(false);
  });

  it("keeps retired recommendation and insight handoffs free of product API requests", () => {
    const graph = collectRuntimeGraph([compatibilityEntry]);
    expect([...graph.keys()].some((file) => /[\\/]api[\\/]/.test(file))).toBe(false);
    expect([...graph.values()].some((source) => source.includes("@tanstack/react-query"))).toBe(
      false,
    );
  });
});
