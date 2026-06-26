import type { PrismaClient, UserPreference } from "@prisma/client";

export const DEFAULT_WORKING_HOURS_START = "09:00";
export const DEFAULT_WORKING_HOURS_END = "18:00";

export const PREFERENCE_KEYS = [
  "working_hours_start",
  "working_hours_end",
  "default_meeting_duration_minutes",
  "preferred_calendar_behavior"
] as const;

export type PreferenceKey = (typeof PREFERENCE_KEYS)[number];

export const PREFERENCE_LABELS: Record<PreferenceKey, string> = {
  working_hours_start: "Working hours start",
  working_hours_end: "Working hours end",
  default_meeting_duration_minutes: "Default meeting duration",
  preferred_calendar_behavior: "Preferred calendar behavior"
};

export type EffectiveCalendarPreferences = {
  workingHoursStart: string;
  workingHoursEnd: string;
  defaultMeetingDurationMinutes?: number;
};

function assertTimeOfDay(value: string): string {
  const normalized = value.trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    throw new Error("Use HH:MM in 24-hour local time, for example 09:00.");
  }
  return normalized;
}

function assertDurationMinutes(value: string): string {
  const normalized = value.trim();
  const duration = Number(normalized);
  if (!Number.isInteger(duration) || duration < 15 || duration > 480) {
    throw new Error("Default meeting duration must be an integer from 15 to 480 minutes.");
  }
  return String(duration);
}

function parseTimeOfDayMinutes(value: string): number | undefined {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function normalizePreferenceValue(key: PreferenceKey, value: string): string {
  if (key === "working_hours_start" || key === "working_hours_end") {
    return assertTimeOfDay(value);
  }

  if (key === "default_meeting_duration_minutes") {
    return assertDurationMinutes(value);
  }

  const normalized = value.trim();
  if (!normalized) throw new Error("Preference value cannot be empty.");
  if (normalized.length > 1000) throw new Error("Preference value must be 1000 characters or less.");
  return normalized;
}

export async function listUserPreferences(db: PrismaClient, userId: string): Promise<UserPreference[]> {
  return db.userPreference.findMany({
    where: { userId },
    orderBy: { key: "asc" }
  });
}

export function resolveCalendarPreferencesFromList(
  preferences: Pick<UserPreference, "key" | "value">[]
): EffectiveCalendarPreferences {
  const values = new Map(preferences.map((preference) => [preference.key, preference.value]));
  const rawStart = values.get("working_hours_start") ?? DEFAULT_WORKING_HOURS_START;
  const rawEnd = values.get("working_hours_end") ?? DEFAULT_WORKING_HOURS_END;
  const startMinutes = parseTimeOfDayMinutes(rawStart);
  const endMinutes = parseTimeOfDayMinutes(rawEnd);
  const hasValidWorkingHours =
    startMinutes !== undefined && endMinutes !== undefined && startMinutes < endMinutes;

  const rawDuration = values.get("default_meeting_duration_minutes");
  const duration = rawDuration ? Number(rawDuration) : Number.NaN;

  return {
    workingHoursStart: hasValidWorkingHours ? rawStart : DEFAULT_WORKING_HOURS_START,
    workingHoursEnd: hasValidWorkingHours ? rawEnd : DEFAULT_WORKING_HOURS_END,
    defaultMeetingDurationMinutes:
      Number.isInteger(duration) && duration >= 15 && duration <= 480 ? duration : undefined
  };
}

export async function resolveCalendarPreferences(
  db: PrismaClient,
  userId: string
): Promise<EffectiveCalendarPreferences> {
  return resolveCalendarPreferencesFromList(await listUserPreferences(db, userId));
}

export async function saveUserPreference(
  db: PrismaClient,
  userId: string,
  input: { key: PreferenceKey; value: string }
): Promise<UserPreference> {
  const value = normalizePreferenceValue(input.key, input.value);
  return db.userPreference.upsert({
    where: { userId_key: { userId, key: input.key } },
    create: { userId, key: input.key, value },
    update: { value }
  });
}

export async function deleteUserPreference(
  db: PrismaClient,
  userId: string,
  key: PreferenceKey
): Promise<{ deleted: boolean }> {
  const existing = await db.userPreference.findUnique({
    where: { userId_key: { userId, key } }
  });
  if (!existing) return { deleted: false };

  await db.userPreference.delete({
    where: { userId_key: { userId, key } }
  });
  return { deleted: true };
}

export async function deleteAllUserPreferences(
  db: PrismaClient,
  userId: string
): Promise<{ count: number }> {
  return db.userPreference.deleteMany({ where: { userId } });
}

export function formatPreferencesForAssistant(preferences: UserPreference[]): string {
  if (preferences.length === 0) return "None saved.";
  return preferences
    .map((preference) => `- ${PREFERENCE_LABELS[preference.key as PreferenceKey] ?? preference.key}: ${preference.value}`)
    .join("\n");
}

export function formatPreferencesForTelegram(preferences: UserPreference[]): string {
  if (preferences.length === 0) {
    return [
      "No saved preferences yet.",
      "You can ask me to remember calendar preferences like working hours or default meeting duration."
    ].join("\n");
  }

  return ["Saved preferences:", formatPreferencesForAssistant(preferences)].join("\n");
}
