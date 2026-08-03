import { describe, expect, it } from "vitest";
import {
  getOfficialSourceAdapterDescriptor,
  officialSourceAdapterDescriptors,
  parseOfficialSourceAdapterOptions,
} from "./official-source-adapters.js";

describe("official source adapter descriptors", () => {
  it("keeps network and manual handlers mutually exclusive", () => {
    expect(Object.keys(officialSourceAdapterDescriptors)).toHaveLength(11);

    for (const descriptor of Object.values(officialSourceAdapterDescriptors)) {
      expect(descriptor.adapterKey).toBeTruthy();
      expect(descriptor.adapterVersion).toBeTruthy();
      expect(descriptor.normalizerVersion).toBeTruthy();
      expect(descriptor.pipelineVersion).toBeTruthy();
      if (descriptor.acquisitionMode === "browser_required") {
        expect(descriptor.probeHandler).toBeNull();
        expect(descriptor.manualHandler).not.toBeNull();
      } else {
        expect(descriptor.probeHandler).not.toBeNull();
        expect(descriptor.manualHandler).toBeNull();
      }
    }
  });

  it("rejects options that are not part of an adapter contract", () => {
    expect(() =>
      parseOfficialSourceAdapterOptions("bytedance-manual-browser-snapshot", {
        cookie: "forbidden",
      }),
    ).toThrowError("ADAPTER_OPTIONS_INVALID");
    expect(() =>
      parseOfficialSourceAdapterOptions("beisen-zhiye-public-api", {
        category: "3",
        pageIndex: 0,
      }),
    ).toThrowError("ADAPTER_OPTIONS_INVALID");
  });

  it("does not resolve unknown adapter keys", () => {
    expect(() => getOfficialSourceAdapterDescriptor("dynamic-plugin")).toThrowError(
      "ADAPTER_NOT_IMPLEMENTED",
    );
  });
});
