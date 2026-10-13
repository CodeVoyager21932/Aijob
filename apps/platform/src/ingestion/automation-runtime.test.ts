import { describe, it, expect } from "vitest";
import {
  mayExecuteSourceNetwork,
  controlledCollectorEnabled,
  collectorRuntimeScopes,
} from "./automation-runtime.js";
describe("controlled collector environment", () => {
  const production = {
    appEnv: "production" as const,
    enableSourceProbe: false,
    controlledAutomation: true,
    collectorIsolation: "container" as const,
  };
  it("permits only approved-scope scheduled execution in an explicitly enabled collector container", () => {
    expect(controlledCollectorEnabled(production)).toBe(true);
    expect(collectorRuntimeScopes(production)).toEqual(["production"]);
    expect(mayExecuteSourceNetwork(production, "scheduled")).toBe(true);
    expect(mayExecuteSourceNetwork(production, "probe")).toBe(false);
    expect(
      mayExecuteSourceNetwork({ ...production, controlledAutomation: false }, "scheduled"),
    ).toBe(false);
    expect(
      mayExecuteSourceNetwork(
        { appEnv: "production", enableSourceProbe: true, controlledAutomation: true },
        "scheduled",
      ),
    ).toBe(false);
  });
  it("never enables source network in tests/CI and preserves explicit local probing", () => {
    expect(mayExecuteSourceNetwork(production, "scheduled", true)).toBe(false);
    expect(mayExecuteSourceNetwork({ ...production, appEnv: "test" }, "scheduled")).toBe(false);
    expect(mayExecuteSourceNetwork({ appEnv: "local", enableSourceProbe: true }, "probe")).toBe(
      true,
    );
  });
});
