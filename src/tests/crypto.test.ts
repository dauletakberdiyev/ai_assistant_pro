import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../security/crypto.js";

describe("secret encryption", () => {
  it("round-trips encrypted secrets", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const encrypted = encryptSecret("refresh-token", key);

    expect(encrypted).not.toBe("refresh-token");
    expect(decryptSecret(encrypted, key)).toBe("refresh-token");
  });

  it("rejects tampered ciphertext", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const encrypted = encryptSecret("refresh-token", key);
    const [iv, tag, ciphertext] = encrypted.split(".");
    const tamperedTag = `${tag?.startsWith("A") ? "B" : "A"}${tag?.slice(1)}`;
    const tampered = [iv, tamperedTag, ciphertext].join(".");

    expect(() => decryptSecret(tampered, key)).toThrow();
  });
});
