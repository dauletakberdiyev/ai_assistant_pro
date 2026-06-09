import type { CalendarEventDraft, PrismaClient } from "@prisma/client";
import type { calendar_v3 } from "googleapis";
import type { Env } from "../config/env.js";
import { getCalendarClient, insertCalendarEvent } from "../google/calendar.js";

export const DRAFT_STATUS = {
  Pending: "pending",
  Confirmed: "confirmed",
  Canceled: "canceled"
} as const;

export type DraftCalendarEventInput = {
  title: string;
  startTime: Date;
  endTime: Date;
  timezone: string;
  description?: string;
  location?: string;
  recurrenceRule?: string;
};

export async function createCalendarEventDraft(
  db: PrismaClient,
  userId: string,
  input: DraftCalendarEventInput
): Promise<CalendarEventDraft> {
  if (input.endTime <= input.startTime) {
    throw new Error("Calendar event end time must be after start time");
  }

  return db.calendarEventDraft.create({
    data: {
      userId,
      status: DRAFT_STATUS.Pending,
      title: input.title,
      startTime: input.startTime,
      endTime: input.endTime,
      timezone: input.timezone,
      description: input.description,
      location: input.location,
      recurrenceRule: input.recurrenceRule
    }
  });
}

export async function confirmCalendarEventDraftWithClient(
  db: PrismaClient,
  calendar: calendar_v3.Calendar,
  userId: string,
  draftId: string
) {
  const draft = await db.calendarEventDraft.findFirst({
    where: { id: draftId, userId, status: DRAFT_STATUS.Pending }
  });

  if (!draft) {
    throw new Error("Pending calendar event draft was not found");
  }

  const event = await insertCalendarEvent(calendar, {
    title: draft.title,
    startTime: draft.startTime,
    endTime: draft.endTime,
    timezone: draft.timezone,
    description: draft.description ?? undefined,
    location: draft.location ?? undefined,
    recurrenceRule: draft.recurrenceRule ?? undefined
  });

  const updatedDraft = await db.calendarEventDraft.update({
    where: { id: draft.id },
    data: {
      status: DRAFT_STATUS.Confirmed,
      googleEventId: event.id ?? null,
      confirmedAt: new Date()
    }
  });

  return { draft: updatedDraft, event };
}

export async function confirmCalendarEventDraft(
  db: PrismaClient,
  env: Env,
  userId: string,
  draftId: string
) {
  const calendar = await getCalendarClient(db, env, userId);
  return confirmCalendarEventDraftWithClient(db, calendar, userId, draftId);
}

export async function cancelCalendarEventDraft(
  db: PrismaClient,
  userId: string,
  draftId: string
) {
  const draft = await db.calendarEventDraft.findFirst({
    where: { id: draftId, userId, status: DRAFT_STATUS.Pending }
  });

  if (!draft) {
    throw new Error("Pending calendar event draft was not found");
  }

  return db.calendarEventDraft.update({
    where: { id: draft.id },
    data: {
      status: DRAFT_STATUS.Canceled,
      canceledAt: new Date()
    }
  });
}

export function formatDraftForTelegram(draft: CalendarEventDraft): string {
  const start = draft.startTime.toLocaleString("en-US", { timeZone: draft.timezone });
  const end = draft.endTime.toLocaleString("en-US", { timeZone: draft.timezone });
  const lines = [`Confirm calendar event?`, `Title: ${draft.title}`, `When: ${start} - ${end}`];
  if (draft.location) lines.push(`Location: ${draft.location}`);
  if (draft.description) lines.push(`Description: ${draft.description}`);
  if (draft.recurrenceRule) lines.push(`Repeats: ${draft.recurrenceRule}`);
  return lines.join("\n");
}
