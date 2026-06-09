import { describe, expect, it } from "vitest";
import { assertAllowedTelegramUser } from "../telegram/auth.js";

describe("assertAllowedTelegramUser", () => {
  it("returns the normalized user id for the allowed Telegram user", () => {
    expect(assertAllowedTelegramUser(12345, "12345")).toBe("12345");
  });

  it("rejects any non-allowed Telegram user", () => {
    expect(() => assertAllowedTelegramUser(99999, "12345")).toThrow("not allowed");
  });

  it("rejects updates without a Telegram user id", () => {
    expect(() => assertAllowedTelegramUser(undefined, "12345")).toThrow("missing");
  });
});
