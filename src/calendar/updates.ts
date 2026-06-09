import type { CalendarEventUpdateDraft, PrismaClient } from "@prisma/client";
import type { calendar_v3 } from "googleapis";
import type { Env } from "../config/env.js";
import { getCalendarClient, patchCalendarEvent } from "../google/calendar.js";

export const UPDATE_STATUS = {
  Pending: "pending",
  Confirmed: "confirmed",
  Canceled: "canceled"
} as const;

export type DraftCalendarUpdateInput = {
  googleEventId: string;
  currentTitle: string;
  newTitle?: string;
  newStartTime?: Date;
  newEndTime?: Date;
  timezone: string;
  newDescription?: string;
  newLocation?: string;
  newRecurrenceRule?: string;
};

function hasUpdate(input: DraftCalendarUpdateInput): boolean {
  return (
    input.newTitle !== undefined ||
    input.newStartTime !== undefined ||
    input.newEndTime !== undefined ||
    input.newDescription !== undefined ||
    input.newLocation !== undefined ||
    input.newRecurrenceRule !== undefined
  );
}

export async function createCalendarUpdateDraft(
  db: PrismaClient,
  userId: string,
  input: DraftCalendarUpdateInput
): Promise<CalendarEventUpdateDraft> {
  if (!hasUpdate(input)) {
    throw new Error("Calendar update draft must include at least one change");
  }

  if ((input.newStartTime && !input.newEndTime) || (!input.newStartTime && input.newEndTime)) {
    throw new Error("Calendar event time updates must include both start and end time");
  }

  if (input.newStartTime && input.newEndTime && input.newEndTime <= input.newStartTime) {
    throw new Error("Calendar event end time must be after start time");
  }

  return db.calendarEventUpdateDraft.create({
    data: {
      userId,
      status: UPDATE_STATUS.Pending,
      googleEventId: input.googleEventId,
      currentTitle: input.currentTitle,
      newTitle: input.newTitle,
      newStartTime: input.newStartTime,
      newEndTime: input.newEndTime,
      timezone: input.timezone,
      newDescription: input.newDescription,
      newLocation: input.newLocation,
      newRecurrenceRule: input.newRecurrenceRule
    }
  });
}

export async function confirmCalendarUpdateDraftWithClient(
  db: PrismaClient,
  calendar: calendar_v3.Calendar,
  userId: string,
  draftId: string
) {
  const draft = await db.calendarEventUpdateDraft.findFirst({
    where: { id: draftId, userId, status: UPDATE_STATUS.Pending }
  });

  if (!draft) {
    throw new Error("Pending calendar update draft was not found");
  }

  const event = await patchCalendarEvent(calendar, {
    eventId: draft.googleEventId,
    title: draft.newTitle ?? undefined,
    startTime: draft.newStartTime ?? undefined,
    endTime: draft.newEndTime ?? undefined,
    timezone: draft.timezone,
    description: draft.newDescription ?? undefined,
    location: draft.newLocation ?? undefined,
    recurrenceRule: draft.newRecurrenceRule ?? undefined
  });

  const updatedDraft = await db.calendarEventUpdateDraft.update({
    where: { id: draft.id },
    data: {
      status: UPDATE_STATUS.Confirmed,
      confirmedAt: new Date()
    }
  });

  return { draft: updatedDraft, event };
}

export async function confirmCalendarUpdateDraft(
  db: PrismaClient,
  env: Env,
  userId: string,
  draftId: string
) {
  const calendar = await getCalendarClient(db, env, userId);
  return confirmCalendarUpdateDraftWithClient(db, calendar, userId, draftId);
}

export async function cancelCalendarUpdateDraft(
  db: PrismaClient,
  userId: string,
  draftId: string
) {
  const draft = await db.calendarEventUpdateDraft.findFirst({
    where: { id: draftId, userId, status: UPDATE_STATUS.Pending }
  });

  if (!draft) {
    throw new Error("Pending calendar update draft was not found");
  }

  return db.calendarEventUpdateDraft.update({
    where: { id: draft.id },
    data: {
      status: UPDATE_STATUS.Canceled,
      canceledAt: new Date()
    }
  });
}

export function formatUpdateForTelegram(draft: CalendarEventUpdateDraft): string {
  const lines = [`Update this calendar event?`, `Current title: ${draft.currentTitle}`];

  if (draft.newTitle) lines.push(`New title: ${draft.newTitle}`);
  if (draft.newStartTime && draft.newEndTime) {
    const start = draft.newStartTime.toLocaleString("en-US", { timeZone: draft.timezone });
    const end = draft.newEndTime.toLocaleString("en-US", { timeZone: draft.timezone });
    lines.push(`New time: ${start} - ${end}`);
  }
  if (draft.newLocation) lines.push(`New location: ${draft.newLocation}`);
  if (draft.newDescription) lines.push(`New description: ${draft.newDescription}`);
  if (draft.newRecurrenceRule) lines.push(`New repeat rule: ${draft.newRecurrenceRule}`);

  return lines.join("\n");
}
