import nodemailer from "nodemailer";
import type { AppConfig } from "@aijob/config";
import type {
  EmailVerificationDelivery,
  EmailVerificationDeliveryInput,
} from "./email-delivery.js";
import { ServiceError } from "../lib/service-error.js";

export function smtpTransportOptions(config: NonNullable<AppConfig["identity"]["smtp"]>) {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: true,
    auth: { user: config.user, pass: config.password },
    tls: { minVersion: "TLSv1.2" as const, rejectUnauthorized: true },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  };
}
type Sender = {
  sendMail: (message: {
    from: { name: string; address: string };
    to: string;
    subject: string;
    text: string;
    disableFileAccess: boolean;
    disableUrlAccess: boolean;
  }) => Promise<{ accepted: unknown[]; rejected: unknown[] }>;
};
export class SmtpEmailVerificationDelivery implements EmailVerificationDelivery {
  private readonly sender: Sender;
  constructor(
    private readonly config: NonNullable<AppConfig["identity"]["smtp"]>,
    sender?: Sender,
  ) {
    this.sender = sender ?? nodemailer.createTransport(smtpTransportOptions(config));
  }
  async deliver(input: EmailVerificationDeliveryInput): Promise<"delivered"> {
    try {
      const purpose = input.purpose === "claim_owner" ? "绑定邮箱" : "登录";
      const expires = new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        dateStyle: "short",
        timeStyle: "short",
      }).format(input.expiresAt);
      const result = await this.sender.sendMail({
        from: { name: "Aijob", address: this.config.from },
        to: input.email,
        subject: `Aijob ${purpose}验证码`,
        text: `你的${purpose}验证码为：${input.verificationCode}\n有效期至 ${expires}（北京时间）。\n如果这不是你发起的操作，请忽略这封邮件。`,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      if (!result.accepted.length || result.rejected.length) throw new Error("SMTP_REJECTED");
      return "delivered";
    } catch {
      // SMTP errors may include addresses or server credentials; never propagate provider text.
      throw new ServiceError(
        503,
        "EMAIL_DELIVERY_UNAVAILABLE",
        "验证码暂时无法发送，请在重试时间后重新获取。",
      );
    }
  }
}
