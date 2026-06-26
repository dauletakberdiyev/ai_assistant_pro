import type { CalendarEventUpdateDraft, PrismaClient } from "@prisma/client";
import type { calendar_v3 } from "googleapis";
import type { Env } from "../config/env.js";
import { getCalendarClient, patchCalendarEvent } from "../google/calendar.js";
import { consoleStructuredLogger, errorContext, type StructuredLogger } from "../logger.js";

export const UPDATE_STATUS = {
  Pending: "pending",
  Confirming: "confirming",
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
  draftId: string,
  logger: StructuredLogger = consoleStructuredLogger
) {
  const claimed = await db.calendarEventUpdateDraft.updateMany({
    where: { id: draftId, userId, status: UPDATE_STATUS.Pending },
    data: { status: UPDATE_STATUS.Confirming }
  });

  if (claimed.count !== 1) {
    logger.info({ userId, draftId, draftType: "update" }, "calendar draft confirmation not claimed");
    const existing = await db.calendarEventUpdateDraft.findFirst({
      where: { id: draftId, userId }
    });
    if (!existing) {
      throw new Error("Pending calendar update draft was not found");
    }
    if (existing.status === UPDATE_STATUS.Confirmed) {
      return {
        draft: existing,
        event: { id: existing.googleEventId, summary: existing.newTitle ?? existing.currentTitle },
        alreadyProcessed: true
      };
    }
    if (existing.status === UPDATE_STATUS.Confirming) {
      return {
        draft: existing,
        event: { id: existing.googleEventId, summary: existing.newTitle ?? existing.currentTitle },
        alreadyProcessing: true
      };
    }
    throw new Error("Pending calendar update draft was not found");
  }
  logger.info({ userId, draftId, draftType: "update" }, "calendar draft confirmation claimed");

  const draft = await db.calendarEventUpdateDraft.findFirst({
    where: { id: draftId, userId, status: UPDATE_STATUS.Confirming }
  });

  if (!draft) {
    throw new Error("Pending calendar update draft was not found");
  }

  try {
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
    logger.info(
      { userId, draftId, googleEventId: event.id ?? draft.googleEventId, draftType: "update" },
      "calendar event updated"
    );

    const updatedDraft = await db.calendarEventUpdateDraft.update({
      where: { id: draft.id },
      data: {
        status: UPDATE_STATUS.Confirmed,
        confirmedAt: new Date()
      }
    });

    return { draft: updatedDraft, event, alreadyProcessed: false };
  } catch (error) {
    logger.error(
      { userId, draftId, draftType: "update", ...errorContext(error) },
      "calendar event update failed"
    );
    await db.calendarEventUpdateDraft.updateMany({
      where: { id: draft.id, userId, status: UPDATE_STATUS.Confirming },
      data: { status: UPDATE_STATUS.Pending }
    });
    throw error;
  }
}

export async function confirmCalendarUpdateDraft(
  db: PrismaClient,
  env: Env,
  userId: string,
  draftId: string,
  logger?: StructuredLogger
) {
  const calendar = await getCalendarClient(db, env, userId);
  return confirmCalendarUpdateDraftWithClient(db, calendar, userId, draftId, logger);
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
