import { describe, expect, it, vi } from "vitest";
import {
  deleteAllUserPreferences,
  deleteUserPreference,
  formatPreferencesForAssistant,
  normalizePreferenceValue,
  saveUserPreference
} from "../memory/preferences.js";

describe("user preferences", () => {
  it("normalizes constrained preference values", () => {
    expect(normalizePreferenceValue("working_hours_start", " 09:00 ")).toBe("09:00");
    expect(normalizePreferenceValue("default_meeting_duration_minutes", "45")).toBe("45");
    expect(() => normalizePreferenceValue("working_hours_end", "7pm")).toThrow();
    expect(() => normalizePreferenceValue("default_meeting_duration_minutes", "5")).toThrow();
  });

  it("upserts normalized preference values", async () => {
    const upsert = vi.fn(async ({ create, update }) => ({
      id: "preference_1",
      userId: create.userId,
      key: create.key,
      value: update.value,
      createdAt: new Date("2026-06-15T00:00:00.000Z"),
      updatedAt: new Date("2026-06-15T00:00:00.000Z")
    }));
    const db = { userPreference: { upsert } } as any;

    const preference = await saveUserPreference(db, "user_1", {
      key: "working_hours_start",
      value: " 10:30 "
    });

    expect(upsert).toHaveBeenCalledWith({
      where: { userId_key: { userId: "user_1", key: "working_hours_start" } },
      create: { userId: "user_1", key: "working_hours_start", value: "10:30" },
      update: { value: "10:30" }
    });
    expect(preference.value).toBe("10:30");
  });

  it("deletes one preference only when it exists", async () => {
    const findUnique = vi.fn(async () => null);
    const del = vi.fn();
    const db = { userPreference: { findUnique, delete: del } } as any;

    await expect(deleteUserPreference(db, "user_1", "working_hours_end")).resolves.toEqual({
      deleted: false
    });
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes all preferences for the user", async () => {
    const deleteMany = vi.fn(async () => ({ count: 3 }));
    const db = { userPreference: { deleteMany } } as any;

    await expect(deleteAllUserPreferences(db, "user_1")).resolves.toEqual({ count: 3 });
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1" } });
  });

  it("formats preferences for assistant instructions", () => {
    const text = formatPreferencesForAssistant([
      {
        key: "default_meeting_duration_minutes",
        value: "45"
      }
    ] as any);

    expect(text).toContain("Default meeting duration: 45");
  });
});
