import { describe, expect, it } from "vitest";
import { isLoopbackHost, parseAppConfig } from "./index.js";

describe("internal capability network boundary", () => {
  it.each(["127.0.0.1", "127.0.0.42", "::1", "0:0:0:0:0:0:0:1"])(
    "accepts numeric loopback host %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
      expect(() => parseAppConfig({ APP_ENV: "local", HOST: host })).not.toThrow();
    },
  );

  it.each(["0.0.0.0", "192.168.1.20", "localhost", "::"])(
    "rejects non-literal-loopback host %s when local capabilities default on",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
      expect(() => parseAppConfig({ APP_ENV: "local", HOST: host })).toThrow(
        /HOST must be a numeric loopback address/,
      );
    },
  );

  it("allows an external bind only when preview and probing are both disabled", () => {
    const config = parseAppConfig({
      APP_ENV: "local",
      HOST: "0.0.0.0",
      ENABLE_INTERNAL_PREVIEW: "false",
      ENABLE_SOURCE_PROBE: "false",
    });

    expect(config.host).toBe("0.0.0.0");
    expect(config.enableInternalPreview).toBe(false);
    expect(config.enableSourceProbe).toBe(false);
  });

  it("rejects an external bind when either capability is explicitly enabled", () => {
    expect(() =>
      parseAppConfig({
        APP_ENV: "local",
        HOST: "0.0.0.0",
        ENABLE_INTERNAL_PREVIEW: "true",
        ENABLE_SOURCE_PROBE: "false",
      }),
    ).toThrow(/HOST must be a numeric loopback address/);

    expect(() =>
      parseAppConfig({
        APP_ENV: "local",
        HOST: "0.0.0.0",
        ENABLE_INTERNAL_PREVIEW: "false",
        ENABLE_SOURCE_PROBE: "true",
      }),
    ).toThrow(/HOST must be a numeric loopback address/);
  });
});
