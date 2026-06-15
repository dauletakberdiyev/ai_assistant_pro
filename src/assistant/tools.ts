import type {
  CalendarEventCancellationDraft,
  CalendarEventDraft,
  CalendarEventUpdateDraft,
  PrismaClient
} from "@prisma/client";
import type { Env } from "../config/env.js";
import { buildDailyAgenda, deriveBusyBlocksFromEvents } from "../calendar/agenda.js";
import { createCalendarCancellationDraft } from "../calendar/cancellations.js";
import { createCalendarEventDraft } from "../calendar/drafts.js";
import {
  findCalendarConflicts,
  suggestAvailableTimeSlots
} from "../calendar/intelligence.js";
import { createCalendarUpdateDraft } from "../calendar/updates.js";
import { getFreeBusy, listCalendarEvents } from "../google/calendar.js";
import {
  deleteUserPreference,
  formatPreferencesForAssistant,
  listUserPreferences,
  saveUserPreference
} from "../memory/preferences.js";
import {
  confirmCalendarEventSchema,
  deleteUserPreferenceSchema,
  draftCancelCalendarEventSchema,
  draftCalendarEventSchema,
  draftUpdateCalendarEventSchema,
  getDailyAgendaSchema,
  getFreeBusySchema,
  listUserPreferencesSchema,
  listCalendarEventsSchema,
  suggestTimeSlotsSchema,
  updateUserPreferenceSchema,
  type AssistantToolName
} from "./toolSchemas.js";

export type ToolExecutionContext = {
  db: PrismaClient;
  env: Env;
  userId: string;
  assistantRunId: string;
  pendingDrafts: CalendarEventDraft[];
  pendingCancellationDrafts: CalendarEventCancellationDraft[];
  pendingUpdateDrafts: CalendarEventUpdateDraft[];
};

function isInsufficientPermissionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as { code?: unknown; status?: unknown }).code ?? (error as { status?: unknown }).status;
  return (
    status === 403 ||
    error.message.toLowerCase().includes("insufficient permission") ||
    error.message.toLowerCase().includes("insufficient authentication scopes")
  );
}

async function getBusyBlocksForScheduling(
  context: ToolExecutionContext,
  input: { timeMin: string; timeMax: string; timezone: string }
) {
  try {
    const busy = await getFreeBusy(context.db, context.env, context.userId, {
      timeMin: input.timeMin,
      timeMax: input.timeMax
    });
    return { busy, estimated: false };
  } catch (error) {
    if (!isInsufficientPermissionError(error)) throw error;
    const events = await listCalendarEvents(context.db, context.env, context.userId, {
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      maxResults: 50
    });
    return {
      busy: deriveBusyBlocksFromEvents(events, input.timezone),
      estimated: true
    };
  }
}

export async function executeAssistantTool(
  toolName: AssistantToolName,
  rawArguments: unknown,
  context: ToolExecutionContext
) {
  const startedArguments = rawArguments ?? {};

  try {
    const result = await runTool(toolName, startedArguments, context);
    await context.db.toolCall.create({
      data: {
        userId: context.userId,
        assistantRunId: context.assistantRunId,
        name: toolName,
        arguments: startedArguments as object,
        result: result as object
      }
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown tool error";
    await context.db.toolCall.create({
      data: {
        userId: context.userId,
        assistantRunId: context.assistantRunId,
        name: toolName,
        arguments: startedArguments as object,
        error: message
      }
    });
    return { ok: false, error: message };
  }
}

async function runTool(
  toolName: AssistantToolName,
  rawArguments: unknown,
  context: ToolExecutionContext
) {
  switch (toolName) {
    case "list_calendar_events": {
      const input = listCalendarEventsSchema.parse(rawArguments);
      const events = await listCalendarEvents(context.db, context.env, context.userId, {
        timeMin: input.time_min,
        timeMax: input.time_max,
        maxResults: input.max_results
      });
      return { ok: true, events };
    }

    case "get_free_busy": {
      const input = getFreeBusySchema.parse(rawArguments);
      const busy = await getFreeBusy(context.db, context.env, context.userId, {
        timeMin: input.time_min,
        timeMax: input.time_max
      });
      return { ok: true, busy };
    }

    case "get_daily_agenda": {
      const input = getDailyAgendaSchema.parse(rawArguments);
      const agenda = await buildDailyAgenda(context.db, context.env, context.userId, {
        date: input.date
      });
      return { ok: true, agenda };
    }

    case "suggest_time_slots": {
      const input = suggestTimeSlotsSchema.parse(rawArguments);
      const { busy, estimated } = await getBusyBlocksForScheduling(context, {
        timeMin: input.time_min,
        timeMax: input.time_max,
        timezone: input.timezone
      });
      const slots = suggestAvailableTimeSlots({
        busyBlocks: busy,
        timeMin: new Date(input.time_min),
        timeMax: new Date(input.time_max),
        durationMinutes: input.duration_minutes,
        maxSlots: input.max_slots
      });
      return {
        ok: true,
        timezone: input.timezone,
        duration_minutes: input.duration_minutes,
        free_busy_estimated: estimated,
        slots
      };
    }

    case "draft_calendar_event": {
      const input = draftCalendarEventSchema.parse(rawArguments);
      const startTime = new Date(input.start_time);
      const endTime = new Date(input.end_time);
      const { busy, estimated } = await getBusyBlocksForScheduling(context, {
        timeMin: input.start_time,
        timeMax: input.end_time,
        timezone: input.timezone
      });
      const conflicts = findCalendarConflicts(busy, startTime, endTime);
      if (conflicts.length > 0) {
        return {
          ok: false,
          requires_clarification: true,
          error: "The requested time overlaps existing calendar busy blocks.",
          free_busy_estimated: estimated,
          conflicts
        };
      }

      const draft = await createCalendarEventDraft(context.db, context.userId, {
        title: input.title,
        startTime,
        endTime,
        timezone: input.timezone,
        description: input.description,
        location: input.location,
        recurrenceRule: input.recurrence_rule
      });
      context.pendingDrafts.push(draft);
      return {
        ok: true,
        requires_confirmation: true,
        draft: {
          id: draft.id,
          title: draft.title,
          start_time: draft.startTime.toISOString(),
          end_time: draft.endTime.toISOString(),
          timezone: draft.timezone,
          recurrence_rule: draft.recurrenceRule,
          free_busy_estimated: estimated
        }
      };
    }

    case "draft_cancel_calendar_event": {
      const input = draftCancelCalendarEventSchema.parse(rawArguments);
      const draft = await createCalendarCancellationDraft(context.db, context.userId, {
        googleEventId: input.event_id,
        title: input.title,
        startTime: input.start_time ? new Date(input.start_time) : undefined,
        endTime: input.end_time ? new Date(input.end_time) : undefined,
        timezone: input.timezone
      });
      context.pendingCancellationDrafts.push(draft);
      return {
        ok: true,
        requires_confirmation: true,
        cancellation_draft: {
          id: draft.id,
          event_id: draft.googleEventId,
          title: draft.title,
          start_time: draft.startTime?.toISOString(),
          end_time: draft.endTime?.toISOString(),
          timezone: draft.timezone
        }
      };
    }

    case "draft_update_calendar_event": {
      const input = draftUpdateCalendarEventSchema.parse(rawArguments);
      const draft = await createCalendarUpdateDraft(context.db, context.userId, {
        googleEventId: input.event_id,
        currentTitle: input.current_title,
        newTitle: input.new_title,
        newStartTime: input.new_start_time ? new Date(input.new_start_time) : undefined,
        newEndTime: input.new_end_time ? new Date(input.new_end_time) : undefined,
        timezone: input.timezone,
        newDescription: input.new_description,
        newLocation: input.new_location,
        newRecurrenceRule: input.new_recurrence_rule
      });
      context.pendingUpdateDrafts.push(draft);
      return {
        ok: true,
        requires_confirmation: true,
        update_draft: {
          id: draft.id,
          event_id: draft.googleEventId,
          current_title: draft.currentTitle,
          new_title: draft.newTitle,
          new_start_time: draft.newStartTime?.toISOString(),
          new_end_time: draft.newEndTime?.toISOString(),
          timezone: draft.timezone,
          new_description: draft.newDescription,
          new_location: draft.newLocation,
          new_recurrence_rule: draft.newRecurrenceRule
        }
      };
    }

    case "confirm_calendar_event": {
      confirmCalendarEventSchema.parse(rawArguments);
      return {
        ok: false,
        requires_telegram_confirmation: true,
        error: "The user must press the Telegram Confirm button before the event is created."
      };
    }

    case "list_user_preferences": {
      listUserPreferencesSchema.parse(rawArguments);
      const preferences = await listUserPreferences(context.db, context.userId);
      return {
        ok: true,
        preferences: preferences.map((preference) => ({
          key: preference.key,
          value: preference.value,
          updated_at: preference.updatedAt.toISOString()
        })),
        summary: formatPreferencesForAssistant(preferences)
      };
    }

    case "update_user_preference": {
      const input = updateUserPreferenceSchema.parse(rawArguments);
      const preference = await saveUserPreference(context.db, context.userId, input);
      return {
        ok: true,
        preference: {
          key: preference.key,
          value: preference.value,
          updated_at: preference.updatedAt.toISOString()
        }
      };
    }

    case "delete_user_preference": {
      const input = deleteUserPreferenceSchema.parse(rawArguments);
      const result = await deleteUserPreference(context.db, context.userId, input.key);
      return { ok: true, key: input.key, deleted: result.deleted };
    }
  }
}
