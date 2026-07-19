import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface EncryptedResumePayload {
  algorithm: "aes-256-gcm";
  ciphertext: Buffer;
  initializationVector: Buffer;
  authenticationTag: Buffer;
  plaintextSha256: string;
}

function encryptionKey(hexKey: string): Buffer {
  const key = Buffer.from(hexKey, "hex");
  if (key.length !== 32) {
    throw new Error("RESUME_ENCRYPTION_KEY_INVALID");
  }
  return key;
}

export function encryptResumePayload(plaintext: Buffer, hexKey: string): EncryptedResumePayload {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(hexKey), initializationVector);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    algorithm: "aes-256-gcm",
    ciphertext,
    initializationVector,
    authenticationTag: cipher.getAuthTag(),
    plaintextSha256: createHash("sha256").update(plaintext).digest("hex"),
  };
}

export function decryptResumePayload(
  payload: Pick<
    EncryptedResumePayload,
    "ciphertext" | "initializationVector" | "authenticationTag"
  >,
  hexKey: string,
): Buffer {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(hexKey),
    payload.initializationVector,
  );
  decipher.setAuthTag(payload.authenticationTag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
}
