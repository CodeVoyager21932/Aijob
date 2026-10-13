export interface AutomationRuntime {
  appEnv: "local" | "test" | "alpha" | "production";
  enableSourceProbe: boolean;
  controlledAutomation?: boolean;
  collectorIsolation?: "container";
}
export function controlledCollectorEnabled(runtime: AutomationRuntime) {
  return (
    (runtime.appEnv === "alpha" || runtime.appEnv === "production") &&
    runtime.controlledAutomation === true &&
    runtime.collectorIsolation === "container"
  );
}
export function collectorRuntimeScopes(
  runtime: AutomationRuntime,
): Array<"local" | "alpha" | "production"> {
  return controlledCollectorEnabled(runtime)
    ? [runtime.appEnv as "alpha" | "production"]
    : ["local"];
}
export function mayExecuteSourceNetwork(
  runtime: AutomationRuntime,
  runMode: "probe" | "scheduled",
  automatedTest = false,
) {
  if (automatedTest) return false;
  if (runtime.appEnv === "local") return runtime.enableSourceProbe;
  return runMode === "scheduled" && controlledCollectorEnabled(runtime);
}
