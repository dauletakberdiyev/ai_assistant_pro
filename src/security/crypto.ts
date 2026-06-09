import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function normalizeKey(rawKey: string): Buffer {
  const trimmed = rawKey.trim();
  const candidates = [
    Buffer.from(trimmed, "base64"),
    Buffer.from(trimmed, "hex"),
    Buffer.from(trimmed, "utf8")
  ];

  const exact = candidates.find((candidate) => candidate.length === 32);
  if (exact) return exact;

  return crypto.createHash("sha256").update(trimmed).digest();
}

export function encryptSecret(value: string, rawKey: string): string {
  const key = normalizeKey(rawKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv, tag, ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(payload: string, rawKey: string): string {
  const [ivEncoded, tagEncoded, ciphertextEncoded] = payload.split(".");
  if (!ivEncoded || !tagEncoded || !ciphertextEncoded) {
    throw new Error("Invalid encrypted secret payload");
  }

  const key = normalizeKey(rawKey);
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivEncoded, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, "base64url")),
    decipher.final()
  ]);

  return plaintext.toString("utf8");
}
