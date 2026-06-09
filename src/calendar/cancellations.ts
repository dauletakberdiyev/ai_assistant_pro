import type { CalendarEventCancellationDraft, PrismaClient } from "@prisma/client";
import type { calendar_v3 } from "googleapis";
import type { Env } from "../config/env.js";
import { getCalendarClient } from "../google/calendar.js";

export const CANCELLATION_STATUS = {
  Pending: "pending",
  Confirmed: "confirmed",
  Canceled: "canceled"
} as const;

export type DraftCalendarCancellationInput = {
  googleEventId: string;
  title: string;
  startTime?: Date;
  endTime?: Date;
  timezone: string;
};

export async function createCalendarCancellationDraft(
  db: PrismaClient,
  userId: string,
  input: DraftCalendarCancellationInput
): Promise<CalendarEventCancellationDraft> {
  return db.calendarEventCancellationDraft.create({
    data: {
      userId,
      status: CANCELLATION_STATUS.Pending,
      googleEventId: input.googleEventId,
      title: input.title,
      startTime: input.startTime,
      endTime: input.endTime,
      timezone: input.timezone
    }
  });
}

export async function confirmCalendarCancellationDraftWithClient(
  db: PrismaClient,
  calendar: calendar_v3.Calendar,
  userId: string,
  draftId: string
) {
  const draft = await db.calendarEventCancellationDraft.findFirst({
    where: { id: draftId, userId, status: CANCELLATION_STATUS.Pending }
  });

  if (!draft) {
    throw new Error("Pending calendar cancellation draft was not found");
  }

  await calendar.events.delete({
    calendarId: "primary",
    eventId: draft.googleEventId
  });

  const updatedDraft = await db.calendarEventCancellationDraft.update({
    where: { id: draft.id },
    data: {
      status: CANCELLATION_STATUS.Confirmed,
      confirmedAt: new Date()
    }
  });

  return { draft: updatedDraft };
}

export async function confirmCalendarCancellationDraft(
  db: PrismaClient,
  env: Env,
  userId: string,
  draftId: string
) {
  const calendar = await getCalendarClient(db, env, userId);
  return confirmCalendarCancellationDraftWithClient(db, calendar, userId, draftId);
}

export async function cancelCalendarCancellationDraft(
  db: PrismaClient,
  userId: string,
  draftId: string
) {
  const draft = await db.calendarEventCancellationDraft.findFirst({
    where: { id: draftId, userId, status: CANCELLATION_STATUS.Pending }
  });

  if (!draft) {
    throw new Error("Pending calendar cancellation draft was not found");
  }

  return db.calendarEventCancellationDraft.update({
    where: { id: draft.id },
    data: {
      status: CANCELLATION_STATUS.Canceled,
      canceledAt: new Date()
    }
  });
}

export function formatCancellationForTelegram(draft: CalendarEventCancellationDraft): string {
  const lines = [`Delete this calendar event?`, `Title: ${draft.title}`];
  if (draft.startTime) {
    const start = draft.startTime.toLocaleString("en-US", { timeZone: draft.timezone });
    const end = draft.endTime?.toLocaleString("en-US", { timeZone: draft.timezone });
    lines.push(`When: ${end ? `${start} - ${end}` : start}`);
  }
  return lines.join("\n");
}
