import type { EmailVerificationPurpose } from "@aijob/contracts";

export interface EmailVerificationDeliveryInput {
  challengeId: string;
  purpose: EmailVerificationPurpose;
  email: string;
  verificationCode: string;
  expiresAt: Date;
}

export interface EmailVerificationDelivery {
  deliver(input: EmailVerificationDeliveryInput): Promise<"delivered" | "suppressed">;
}

/**
 * Fail-closed runtime placeholder. It never logs or exports the address/code.
 * A reviewed provider adapter must replace it before a real Alpha is started.
 */
export class DisabledEmailVerificationDelivery implements EmailVerificationDelivery {
  async deliver(_input: EmailVerificationDeliveryInput): Promise<"suppressed"> {
    return "suppressed";
  }
}

/** Local/test-only delivery used by integration and browser fixtures. */
export class FixtureEmailVerificationDelivery implements EmailVerificationDelivery {
  readonly deliveries: EmailVerificationDeliveryInput[] = [];

  async deliver(input: EmailVerificationDeliveryInput): Promise<"delivered"> {
    this.deliveries.push({ ...input });
    return "delivered";
  }
}
