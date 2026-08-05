export interface WorkspacePreferences {
  version: 1;
  sidebarCollapsed: boolean;
  inspectorWidth: number;
}

const preferenceKey = "aijob:career-os-ui:v1";

export const defaultWorkspacePreferences: WorkspacePreferences = {
  version: 1,
  sidebarCollapsed: false,
  inspectorWidth: 360,
};

export function clampInspectorWidth(width: number): number {
  return Math.min(460, Math.max(312, Math.round(width)));
}

export function readWorkspacePreferences(): WorkspacePreferences {
  if (typeof window === "undefined") return defaultWorkspacePreferences;

  try {
    const stored = window.localStorage.getItem(preferenceKey);
    if (!stored) return defaultWorkspacePreferences;
    const parsed = JSON.parse(stored) as Partial<WorkspacePreferences>;
    if (parsed.version !== 1) return defaultWorkspacePreferences;
    return {
      version: 1,
      sidebarCollapsed: parsed.sidebarCollapsed === true,
      inspectorWidth: clampInspectorWidth(
        typeof parsed.inspectorWidth === "number"
          ? parsed.inspectorWidth
          : defaultWorkspacePreferences.inspectorWidth,
      ),
    };
  } catch {
    return defaultWorkspacePreferences;
  }
}

export function writeWorkspacePreferences(preferences: WorkspacePreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(preferenceKey, JSON.stringify(preferences));
  } catch {
    // UI preferences are optional; storage failures must not block the workspace.
  }
}
