export type LegacySurface =
  | "job_detail_actions"
  | "recommendations"
  | "insights"
  | "resume_tailoring"
  | "data_control";

export type LegacySurfaceMode = "legacy" | "case_only" | "compatibility" | "read_only" | "redirect";

const careerOsV2Modes: Record<LegacySurface, Exclude<LegacySurfaceMode, "legacy">> = {
  job_detail_actions: "case_only",
  recommendations: "compatibility",
  insights: "compatibility",
  resume_tailoring: "read_only",
  data_control: "redirect",
};

export function legacySurfaceMode(
  careerOsV2Enabled: boolean,
  surface: LegacySurface,
): LegacySurfaceMode {
  return careerOsV2Enabled ? careerOsV2Modes[surface] : "legacy";
}

export function resumeCompletionPath(
  careerOsV2Enabled: boolean,
  source: "saved" | "confirmed",
): string {
  if (!careerOsV2Enabled) return "/recommendations?start=1";
  return source === "confirmed" ? "/resumes?source=confirmed" : "/resumes";
}
