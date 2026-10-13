import { describe, it, expect, vi } from "vitest";
import { SmtpEmailVerificationDelivery, smtpTransportOptions } from "./smtp-delivery.js";
const config = {
  host: "smtp.example.test",
  port: 587,
  secure: false,
  user: "fixture",
  password: "fixture-secret",
  from: "noreply@example.test",
};
const input = {
  challengeId: "fixture",
  purpose: "sign_in" as const,
  email: "student@example.test",
  verificationCode: "123456",
  expiresAt: new Date("2026-09-06T09:00:00Z"),
};
describe("SMTP adapter without external delivery", () => {
  it("requires verified TLS and disables attachment network/filesystem access", () => {
    expect(smtpTransportOptions(config)).toMatchObject({
      requireTLS: true,
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
    });
  });
  it("sends one plain text verification message through the injected transport", async () => {
    const sendMail = vi.fn(async (_message: unknown) => ({
      accepted: [input.email],
      rejected: [],
    }));
    expect(await new SmtpEmailVerificationDelivery(config, { sendMail }).deliver(input)).toBe(
      "delivered",
    );
    expect(sendMail).toHaveBeenCalledOnce();
    expect(sendMail.mock.calls[0]?.[0]).toMatchObject({
      to: input.email,
      text: expect.stringContaining("123456"),
    });
  });
  it("sanitizes rejected and failed delivery without exposing provider messages", async () => {
    const sender = {
      sendMail: async () => {
        throw new Error("secret student@example.test");
      },
    };
    await expect(
      new SmtpEmailVerificationDelivery(config, sender).deliver(input),
    ).rejects.toMatchObject({ code: "EMAIL_DELIVERY_UNAVAILABLE", statusCode: 503 });
  });
});
