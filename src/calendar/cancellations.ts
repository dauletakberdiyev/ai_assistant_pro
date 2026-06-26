import type { CalendarEventCancellationDraft, PrismaClient } from "@prisma/client";
import type { calendar_v3 } from "googleapis";
import type { Env } from "../config/env.js";
import { getCalendarClient } from "../google/calendar.js";
import { consoleStructuredLogger, errorContext, type StructuredLogger } from "../logger.js";

export const CANCELLATION_STATUS = {
  Pending: "pending",
  Confirming: "confirming",
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
  draftId: string,
  logger: StructuredLogger = consoleStructuredLogger
) {
  const claimed = await db.calendarEventCancellationDraft.updateMany({
    where: { id: draftId, userId, status: CANCELLATION_STATUS.Pending },
    data: { status: CANCELLATION_STATUS.Confirming }
  });

  if (claimed.count !== 1) {
    logger.info({ userId, draftId, draftType: "delete" }, "calendar draft confirmation not claimed");
    const existing = await db.calendarEventCancellationDraft.findFirst({
      where: { id: draftId, userId }
    });
    if (!existing) {
      throw new Error("Pending calendar cancellation draft was not found");
    }
    if (existing.status === CANCELLATION_STATUS.Confirmed) {
      return { draft: existing, alreadyProcessed: true };
    }
    if (existing.status === CANCELLATION_STATUS.Confirming) {
      return { draft: existing, alreadyProcessing: true };
    }
    throw new Error("Pending calendar cancellation draft was not found");
  }
  logger.info({ userId, draftId, draftType: "delete" }, "calendar draft confirmation claimed");

  const draft = await db.calendarEventCancellationDraft.findFirst({
    where: { id: draftId, userId, status: CANCELLATION_STATUS.Confirming }
  });

  if (!draft) {
    throw new Error("Pending calendar cancellation draft was not found");
  }

  try {
    await calendar.events.delete({
      calendarId: "primary",
      eventId: draft.googleEventId
    });
    logger.info(
      { userId, draftId, googleEventId: draft.googleEventId, draftType: "delete" },
      "calendar event deleted"
    );

    const updatedDraft = await db.calendarEventCancellationDraft.update({
      where: { id: draft.id },
      data: {
        status: CANCELLATION_STATUS.Confirmed,
        confirmedAt: new Date()
      }
    });

    return { draft: updatedDraft, alreadyProcessed: false };
  } catch (error) {
    logger.error(
      { userId, draftId, draftType: "delete", ...errorContext(error) },
      "calendar event deletion failed"
    );
    await db.calendarEventCancellationDraft.updateMany({
      where: { id: draft.id, userId, status: CANCELLATION_STATUS.Confirming },
      data: { status: CANCELLATION_STATUS.Pending }
    });
    throw error;
  }
}

export async function confirmCalendarCancellationDraft(
  db: PrismaClient,
  env: Env,
  userId: string,
  draftId: string,
  logger?: StructuredLogger
) {
  const calendar = await getCalendarClient(db, env, userId);
  return confirmCalendarCancellationDraftWithClient(db, calendar, userId, draftId, logger);
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
