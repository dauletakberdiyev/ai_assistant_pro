import { google, calendar_v3 } from "googleapis";
import type { PrismaClient } from "@prisma/client";
import type { Env } from "../config/env.js";
import { getAuthorizedGoogleClient } from "./oauth.js";

export type CalendarEventInput = {
  title: string;
  startTime: Date;
  endTime: Date;
  timezone: string;
  description?: string;
  location?: string;
  recurrenceRule?: string;
  assistantDraftId?: string;
};

export type CalendarEventUpdateInput = {
  eventId: string;
  title?: string;
  startTime?: Date;
  endTime?: Date;
  timezone: string;
  description?: string;
  location?: string;
  recurrenceRule?: string;
};

export async function getCalendarClient(db: PrismaClient, env: Env, userId: string) {
  const auth = await getAuthorizedGoogleClient(db, env, userId);
  return google.calendar({ version: "v3", auth });
}

export async function listCalendarEvents(
  db: PrismaClient,
  env: Env,
  userId: string,
  input: { timeMin: string; timeMax: string; maxResults: number }
) {
  const calendar = await getCalendarClient(db, env, userId);
  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: input.timeMin,
    timeMax: input.timeMax,
    maxResults: input.maxResults,
    singleEvents: true,
    orderBy: "startTime"
  });

  return (response.data.items ?? []).map((event) => ({
    id: event.id,
    summary: event.summary,
    start: event.start,
    end: event.end,
    location: event.location,
    description: event.description
  }));
}

export async function getFreeBusy(
  db: PrismaClient,
  env: Env,
  userId: string,
  input: { timeMin: string; timeMax: string }
) {
  const calendar = await getCalendarClient(db, env, userId);
  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      items: [{ id: "primary" }]
    }
  });

  return response.data.calendars?.primary?.busy ?? [];
}

export async function insertCalendarEvent(
  calendar: calendar_v3.Calendar,
  input: CalendarEventInput
) {
  const response = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: input.title,
      description: input.description,
      location: input.location,
      start: {
        dateTime: input.startTime.toISOString(),
        timeZone: input.timezone
      },
      end: {
        dateTime: input.endTime.toISOString(),
        timeZone: input.timezone
      },
      recurrence: input.recurrenceRule ? [input.recurrenceRule] : undefined,
      extendedProperties: input.assistantDraftId
        ? {
            private: {
              assistantDraftId: input.assistantDraftId
            }
          }
        : undefined
    }
  });

  return response.data;
}

export async function patchCalendarEvent(
  calendar: calendar_v3.Calendar,
  input: CalendarEventUpdateInput
) {
  const requestBody: calendar_v3.Schema$Event = {};

  if (input.title !== undefined) requestBody.summary = input.title;
  if (input.description !== undefined) requestBody.description = input.description;
  if (input.location !== undefined) requestBody.location = input.location;
  if (input.recurrenceRule !== undefined) requestBody.recurrence = [input.recurrenceRule];
  if (input.startTime !== undefined) {
    requestBody.start = {
      dateTime: input.startTime.toISOString(),
      timeZone: input.timezone
    };
  }
  if (input.endTime !== undefined) {
    requestBody.end = {
      dateTime: input.endTime.toISOString(),
      timeZone: input.timezone
    };
  }

  const response = await calendar.events.patch({
    calendarId: "primary",
    eventId: input.eventId,
    requestBody
  });

  return response.data;
}
