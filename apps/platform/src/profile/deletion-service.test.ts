import { describe, expect, it } from "vitest";
import { createDeletionReceipt, verifyDeletionReceipt } from "./deletion-service.js";

describe("deletion receipt", () => {
  it("expires after 24 hours", () => {
    const secret = "00".repeat(32);
    const issuedAt = new Date("2026-07-29T00:00:00.000Z");
    const receipt = createDeletionReceipt(
      {
        deletionId: "deletion-1",
        ownerId: "owner-1",
        requestedOwnerEpoch: 1,
      },
      secret,
      issuedAt,
    );
    expect(
      verifyDeletionReceipt(receipt, secret, new Date("2026-07-29T23:59:59.999Z")),
    ).not.toBeNull();
    expect(verifyDeletionReceipt(receipt, secret, new Date("2026-07-30T00:00:00.000Z"))).toBeNull();
  });
});
