import { z } from "zod";
import { PREFERENCE_KEYS } from "../memory/preferences.js";

const isoDateTime = z.string().datetime({ offset: true });
const recurrenceRule = z
  .string()
  .trim()
  .max(500)
  .regex(/^RRULE:/i, "Use an RFC 5545 RRULE string starting with RRULE:");
const preferenceKey = z.enum(PREFERENCE_KEYS);

export const listCalendarEventsSchema = z.object({
  time_min: isoDateTime,
  time_max: isoDateTime,
  max_results: z.number().int().min(1).max(20).default(10)
});

export const getFreeBusySchema = z.object({
  time_min: isoDateTime,
  time_max: isoDateTime
});

export const suggestTimeSlotsSchema = z.object({
  time_min: isoDateTime,
  time_max: isoDateTime,
  duration_minutes: z.number().int().min(15).max(480),
  timezone: z.string().min(1),
  max_slots: z.number().int().min(1).max(10).default(5)
});

export const getDailyAgendaSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format")
    .optional()
});

export const draftCalendarEventSchema = z.object({
  title: z.string().min(1).max(200),
  start_time: isoDateTime,
  end_time: isoDateTime,
  timezone: z.string().min(1),
  description: z.string().max(2000).optional(),
  location: z.string().max(500).optional(),
  recurrence_rule: recurrenceRule.optional()
});

export const confirmCalendarEventSchema = z.object({
  draft_id: z.string().min(1)
});

export const listUserPreferencesSchema = z.object({});

export const updateUserPreferenceSchema = z.object({
  key: preferenceKey,
  value: z.string().min(1).max(1000)
});

export const deleteUserPreferenceSchema = z.object({
  key: preferenceKey
});

export const draftCancelCalendarEventSchema = z.object({
  event_id: z.string().min(1),
  title: z.string().min(1).max(200),
  start_time: isoDateTime.optional(),
  end_time: isoDateTime.optional(),
  timezone: z.string().min(1)
});

export const draftUpdateCalendarEventSchema = z
  .object({
    event_id: z.string().min(1),
    current_title: z.string().min(1).max(200),
    new_title: z.string().min(1).max(200).optional(),
    new_start_time: isoDateTime.optional(),
    new_end_time: isoDateTime.optional(),
    timezone: z.string().min(1),
    new_description: z.string().max(2000).optional(),
    new_location: z.string().max(500).optional(),
    new_recurrence_rule: recurrenceRule.optional()
  })
  .refine(
    (input) =>
      input.new_title !== undefined ||
      input.new_start_time !== undefined ||
      input.new_end_time !== undefined ||
      input.new_description !== undefined ||
      input.new_location !== undefined ||
      input.new_recurrence_rule !== undefined,
    { message: "At least one calendar event update field is required" }
  )
  .refine((input) => Boolean(input.new_start_time) === Boolean(input.new_end_time), {
    message: "Calendar event time updates require both new_start_time and new_end_time"
  });

export const assistantTools = [
  {
    type: "function",
    name: "list_calendar_events",
    description: "List Google Calendar events in a specific inclusive time window.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        time_min: {
          type: "string",
          description: "ISO 8601 date-time with timezone offset, e.g. 2026-06-01T09:00:00+05:00."
        },
        time_max: {
          type: "string",
          description: "ISO 8601 date-time with timezone offset."
        },
        max_results: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          default: 10
        }
      },
      required: ["time_min", "time_max"]
    }
  },
  {
    type: "function",
    name: "get_free_busy",
    description: "Return busy blocks from the user's primary Google Calendar.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        time_min: { type: "string", description: "ISO 8601 date-time with timezone offset." },
        time_max: { type: "string", description: "ISO 8601 date-time with timezone offset." }
      },
      required: ["time_min", "time_max"]
    }
  },
  {
    type: "function",
    name: "get_daily_agenda",
    description:
      "Summarize a local calendar day with events, conflicts, free work blocks, and the next upcoming event. Omit date for today in the user's timezone.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        date: {
          type: "string",
          description: "Optional local date in YYYY-MM-DD format."
        }
      },
      required: []
    }
  },
  {
    type: "function",
    name: "suggest_time_slots",
    description:
      "Suggest available time slots inside a specific ISO time window using the user's Google Calendar FreeBusy data. Use this when the user asks when they can schedule something or gives a duration without a specific time.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        time_min: { type: "string", description: "ISO 8601 date-time with timezone offset." },
        time_max: { type: "string", description: "ISO 8601 date-time with timezone offset." },
        duration_minutes: {
          type: "integer",
          minimum: 15,
          maximum: 480,
          description: "Length of the task or meeting to schedule."
        },
        timezone: { type: "string", description: "IANA timezone, e.g. Asia/Almaty." },
        max_slots: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          default: 5
        }
      },
      required: ["time_min", "time_max", "duration_minutes", "timezone"]
    }
  },
  {
    type: "function",
    name: "draft_calendar_event",
    description:
      "Create a pending calendar event draft. This does not write to Google Calendar; the user must confirm with Telegram buttons.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        start_time: { type: "string", description: "ISO 8601 date-time with timezone offset." },
        end_time: { type: "string", description: "ISO 8601 date-time with timezone offset." },
        timezone: { type: "string", description: "IANA timezone, e.g. Asia/Almaty." },
        description: { type: "string" },
        location: { type: "string" },
        recurrence_rule: {
          type: "string",
          description: "Optional RFC 5545 recurrence rule, e.g. RRULE:FREQ=WEEKLY;COUNT=10."
        }
      },
      required: ["title", "start_time", "end_time", "timezone"]
    }
  },
  {
    type: "function",
    name: "draft_cancel_calendar_event",
    description:
      "Create a pending draft to delete a Google Calendar event. Use list_calendar_events first if the event id is not known. This does not delete anything; the user must confirm with Telegram buttons.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        event_id: { type: "string", description: "Google Calendar event id from list_calendar_events." },
        title: { type: "string" },
        start_time: { type: "string", description: "ISO 8601 date-time with timezone offset." },
        end_time: { type: "string", description: "ISO 8601 date-time with timezone offset." },
        timezone: { type: "string", description: "IANA timezone, e.g. Asia/Almaty." }
      },
      required: ["event_id", "title", "timezone"]
    }
  },
  {
    type: "function",
    name: "draft_update_calendar_event",
    description:
      "Create a pending draft to update or reschedule a Google Calendar event. Use list_calendar_events first if the event id is not known. This does not update anything; the user must confirm with Telegram buttons.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        event_id: { type: "string", description: "Google Calendar event id from list_calendar_events." },
        current_title: { type: "string", description: "Current event title for the confirmation message." },
        new_title: { type: "string" },
        new_start_time: { type: "string", description: "ISO 8601 date-time with timezone offset." },
        new_end_time: { type: "string", description: "ISO 8601 date-time with timezone offset." },
        timezone: { type: "string", description: "IANA timezone, e.g. Asia/Almaty." },
        new_description: { type: "string" },
        new_location: { type: "string" },
        new_recurrence_rule: {
          type: "string",
          description: "Optional replacement RFC 5545 recurrence rule, e.g. RRULE:FREQ=WEEKLY;COUNT=10."
        }
      },
      required: ["event_id", "current_title", "timezone"]
    }
  },
  {
    type: "function",
    name: "confirm_calendar_event",
    description:
      "Confirming is reserved for the Telegram inline Confirm button. If called by the assistant, explain that the user must press Confirm.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        draft_id: { type: "string" }
      },
      required: ["draft_id"]
    }
  },
  {
    type: "function",
    name: "list_user_preferences",
    description:
      "List saved user preferences that may affect calendar planning, scheduling, and assistant behavior.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: []
    }
  },
  {
    type: "function",
    name: "update_user_preference",
    description:
      "Save or replace an explicit stable user preference. Use only when the user asks you to remember, save, prefer, default, usually, or set a working-hours/calendar preference.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        key: {
          type: "string",
          enum: PREFERENCE_KEYS,
          description:
            "Preference key. working_hours_start/end use HH:MM local time. default_meeting_duration_minutes is an integer minute count. preferred_calendar_behavior is short free text."
        },
        value: {
          type: "string",
          description: "The preference value. Keep it concise and stable."
        }
      },
      required: ["key", "value"]
    }
  },
  {
    type: "function",
    name: "delete_user_preference",
    description:
      "Delete one saved user preference when the user asks to forget or remove it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        key: {
          type: "string",
          enum: PREFERENCE_KEYS
        }
      },
      required: ["key"]
    }
  }
] as const;

export type AssistantToolName =
  | "list_calendar_events"
  | "get_free_busy"
  | "get_daily_agenda"
  | "suggest_time_slots"
  | "draft_calendar_event"
  | "draft_cancel_calendar_event"
  | "draft_update_calendar_event"
  | "confirm_calendar_event"
  | "list_user_preferences"
  | "update_user_preference"
  | "delete_user_preference";
