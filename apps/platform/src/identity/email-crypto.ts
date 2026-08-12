import {
  createCipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

function masterKey(value: string): Buffer {
  const key = Buffer.from(value, "hex");
  if (key.length !== 32) throw new Error("IDENTITY_MASTER_KEY_INVALID");
  return key;
}

function deriveKey(value: string, purpose: string): Buffer {
  return createHmac("sha256", masterKey(value))
    .update(`aijob:identity:${purpose}:v1`, "utf8")
    .digest();
}

export function emailLookupHash(email: string, identityMasterKey: string): string {
  return createHmac("sha256", deriveKey(identityMasterKey, "email-lookup"))
    .update(email, "utf8")
    .digest("hex");
}

export function verificationCodeHash(input: {
  challengeId: string;
  verificationCode: string;
  identityMasterKey: string;
}): string {
  return createHmac("sha256", deriveKey(input.identityMasterKey, "verification-code"))
    .update(`${input.challengeId}:${input.verificationCode}`, "utf8")
    .digest("hex");
}

export function identityRequestHash(value: string, identityMasterKey: string): string {
  return createHmac("sha256", deriveKey(identityMasterKey, "request"))
    .update(value, "utf8")
    .digest("hex");
}

export function secureHexEqual(first: string, second: string): boolean {
  const firstBytes = Buffer.from(first, "hex");
  const secondBytes = Buffer.from(second, "hex");
  return firstBytes.length === secondBytes.length && timingSafeEqual(firstBytes, secondBytes);
}

export interface EncryptedEmail {
  ciphertext: Buffer;
  nonce: Buffer;
  authenticationTag: Buffer;
  keyVersion: "identity-email-v1";
}

export function encryptEmail(email: string, identityMasterKey: string): EncryptedEmail {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveKey(identityMasterKey, "email-encryption"),
    nonce,
  );
  const ciphertext = Buffer.concat([cipher.update(email, "utf8"), cipher.final()]);
  return {
    ciphertext,
    nonce,
    authenticationTag: cipher.getAuthTag(),
    keyVersion: "identity-email-v1",
  };
}

export function maskEmail(email: string): string {
  const [localPart = "", domain = ""] = email.split("@");
  const visible = localPart.slice(0, 1);
  return `${visible || "*"}***@${domain}`;
}
