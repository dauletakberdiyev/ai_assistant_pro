import type {
  CalendarEventCancellationDraft,
  CalendarEventDraft,
  CalendarEventUpdateDraft,
  Message,
  PrismaClient
} from "@prisma/client";
import type { Env } from "../config/env.js";
import { assistantTools, type AssistantToolName } from "./toolSchemas.js";
import { executeAssistantTool } from "./tools.js";
import { createOpenAIResponse } from "./openaiResponses.js";
import { formatPreferencesForAssistant } from "../memory/preferences.js";
import { consoleStructuredLogger, errorContext, type StructuredLogger } from "../logger.js";

const MAX_TOOL_ROUNDS = 5;

export type AssistantResult = {
  text: string;
  pendingDrafts: CalendarEventDraft[];
  pendingCancellationDrafts: CalendarEventCancellationDraft[];
  pendingUpdateDrafts: CalendarEventUpdateDraft[];
};

function currentLocalIso(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset"
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const offset = values.timeZoneName?.replace("GMT", "") || "+00:00";

  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}${offset}`;
}

function buildInstructions(timezone: string, preferenceSummary: string): string {
  const nowUtc = new Date().toISOString();
  const nowLocal = currentLocalIso(timezone);
  return [
    "You are a concise personal AI assistant reachable from Telegram.",
    "You help the user understand their calendar, find available time, and draft calendar changes.",
    "Use saved preferences when they are relevant, but do not invent preferences that are not saved.",
    "Only save a preference when the user explicitly asks you to remember, save, prefer, default, usually, or set a stable calendar preference.",
    "If the user asks what you remember, use list_user_preferences.",
    "If the user asks you to forget a saved preference, use delete_user_preference.",
    "Use configure_salah_notifications when the user asks to enable, change, or set up salah, namaz, or prayer time notifications for a city.",
    "Use disable_salah_notifications when the user asks to turn off salah, namaz, or prayer time notifications.",
    "Use get_salah_notification_status when the user asks which city salah notifications use or whether they are enabled.",
    "For salah city setup, ask the user for a Kazakh/Cyrillic city name if no city is provided.",
    "If salah city setup returns multiple matches, ask the user to choose by city, region, and district. Do not say notifications are enabled.",
    "If salah city setup returns not_found, ask the user to type the city name correctly in Kazakh/Cyrillic.",
    "Use calendar tools when the answer depends on the user's real calendar.",
    "Use get_daily_agenda when the user asks for today, agenda, daily plan, free blocks, or schedule conflicts for a day.",
    "Use suggest_time_slots when the user asks when they can fit a task or meeting, or provides a duration without a specific start time. If the user gave no duration, omit duration_minutes so saved default meeting duration can be used.",
    "Never claim that a calendar event has been created after draft_calendar_event.",
    "Never claim that a calendar event has been deleted after draft_cancel_calendar_event.",
    "Never claim that a calendar event has been updated after draft_update_calendar_event.",
    "Calendar writes require the user to press a Telegram Confirm button.",
    "Calendar deletions require the user to press a Telegram Confirm delete button.",
    "Calendar updates require the user to press a Telegram Confirm update button.",
    "If the user asks to create a calendar event and all required details are clear, call draft_calendar_event. Do not merely say you are creating a draft.",
    "Only tell the user to press Confirm after draft_calendar_event, draft_cancel_calendar_event, or draft_update_calendar_event returned ok: true.",
    "If a draft tool returns ok: false, explain the specific blocker and do not mention a Confirm button.",
    "When the user asks to cancel or delete an event, find the matching event with list_calendar_events, then draft the cancellation if there is one clear match. Ask a clarifying question if multiple events match.",
    "When the user asks to update or reschedule an event, find the matching event with list_calendar_events, then draft the update if there is one clear match. Include current_start_time and current_end_time from the matched event when changing recurrence without changing time. Ask a clarifying question if multiple events match.",
    "Before drafting a new event for a specific time, check for conflicts. If the draft tool reports a conflict, suggest alternatives instead of drafting.",
    "Ask a clarifying question before using calendar write tools when the requested date, time, duration, timezone, event identity, or recurrence pattern is ambiguous.",
    "For recurring events, use RFC 5545 RRULE strings such as RRULE:FREQ=WEEKLY;COUNT=10. Do not guess an end condition if the user did not provide one; ask whether it should repeat forever, until a date, or for a number of occurrences.",
    "When creating date-times, use ISO 8601 strings with timezone offsets.",
    `User timezone: ${timezone}. Current local time in that timezone: ${nowLocal}. Current UTC time: ${nowUtc}.`,
    `Saved user preferences:\n${preferenceSummary}`,
    "Use the current local time, not UTC, when interpreting words like now, today, tomorrow, this morning, and tonight.",
    "If the user names a timezone, use that timezone for interpretation and include its offset in tool date-times."
  ].join("\n");
}

function toResponseInput(messages: Message[]) {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content
  }));
}

function extractToolArguments(item: any): unknown {
  if (!item.arguments) return {};
  if (typeof item.arguments === "string") return JSON.parse(item.arguments);
  return item.arguments;
}

function extractOutputText(response: any): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const parts: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type === "message") {
      for (const content of item.content ?? []) {
        if (content.type === "output_text" && content.text) {
          parts.push(content.text);
        }
      }
    }
  }

  return parts.join("\n").trim();
}

function hasPendingCalendarAction(result: {
  pendingDrafts: CalendarEventDraft[];
  pendingCancellationDrafts: CalendarEventCancellationDraft[];
  pendingUpdateDrafts: CalendarEventUpdateDraft[];
}) {
  return (
    result.pendingDrafts.length > 0 ||
    result.pendingCancellationDrafts.length > 0 ||
    result.pendingUpdateDrafts.length > 0
  );
}

function removeFalseConfirmationPrompt(
  text: string,
  result: {
    pendingDrafts: CalendarEventDraft[];
    pendingCancellationDrafts: CalendarEventCancellationDraft[];
    pendingUpdateDrafts: CalendarEventUpdateDraft[];
  }
) {
  if (hasPendingCalendarAction(result)) return text;

  const mentionsConfirmation =
    /\b(confirm|confirmation|telegram confirm|press confirm|confirm button)\b/i.test(text);
  const mentionsDrafting = /\b(draft|drafting|creating the draft|creating a draft)\b/i.test(text);
  if (!mentionsConfirmation || !mentionsDrafting) return text;

  return [
    "I could not create a Telegram confirmation draft for that request.",
    "Please send the recurring meeting request again, and I will create a draft message with a Confirm button."
  ].join("\n");
}

export async function runAssistant(
  db: PrismaClient,
  env: Env,
  userId: string,
  userText: string,
  logger: StructuredLogger = consoleStructuredLogger
): Promise<AssistantResult> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const preferences = await db.userPreference.findMany({
    where: { userId },
    orderBy: { key: "asc" }
  });
  const preferenceSummary = formatPreferencesForAssistant(preferences);
  const run = await db.assistantRun.create({
    data: { userId, status: "running", input: userText }
  });
  logger.info({ userId, assistantRunId: run.id }, "assistant run started");

  const pendingDrafts: CalendarEventDraft[] = [];
  const pendingCancellationDrafts: CalendarEventCancellationDraft[] = [];
  const pendingUpdateDrafts: CalendarEventUpdateDraft[] = [];

  try {
    const recentMessages = await db.message.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 12
    });

    let input: any[] = toResponseInput(recentMessages.reverse());
    let finalText = "";

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response: any = await createOpenAIResponse(env.OPENAI_API_KEY, {
        model: env.OPENAI_MODEL,
        instructions: buildInstructions(user.timezone, preferenceSummary),
        input,
        tools: assistantTools as any
      });

      const functionCalls = (response.output ?? []).filter(
        (item: any) => item.type === "function_call"
      );

      if (functionCalls.length === 0) {
        finalText =
          extractOutputText(response) ||
          "I could not produce a response. Please try rephrasing that.";
        finalText = removeFalseConfirmationPrompt(finalText, {
          pendingDrafts,
          pendingCancellationDrafts,
          pendingUpdateDrafts
        });
        await db.assistantRun.update({
          where: { id: run.id },
          data: { status: "completed", output: finalText }
        });
        logger.info(
          {
            userId,
            assistantRunId: run.id,
            pendingDrafts: pendingDrafts.length,
            pendingCancellationDrafts: pendingCancellationDrafts.length,
            pendingUpdateDrafts: pendingUpdateDrafts.length
          },
          "assistant run completed"
        );
        return { text: finalText, pendingDrafts, pendingCancellationDrafts, pendingUpdateDrafts };
      }

      input = [...input, ...(response.output ?? [])];

      for (const call of functionCalls) {
        const result = await executeAssistantTool(call.name as AssistantToolName, extractToolArguments(call), {
          db,
          env,
          userId,
          assistantRunId: run.id,
          pendingDrafts,
          pendingCancellationDrafts,
          pendingUpdateDrafts,
          logger
        });

        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result)
        });
      }
    }

    finalText = "I hit the tool-call limit while working on that. Please try a narrower request.";
    await db.assistantRun.update({
      where: { id: run.id },
      data: { status: "failed", output: finalText, error: "Tool-call limit reached" }
    });
    logger.warn({ userId, assistantRunId: run.id }, "assistant run reached tool-call limit");
    return { text: finalText, pendingDrafts, pendingCancellationDrafts, pendingUpdateDrafts };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown assistant error";
    await db.assistantRun.update({
      where: { id: run.id },
      data: { status: "failed", error: message }
    });
    logger.error(
      {
        userId,
        assistantRunId: run.id,
        ...errorContext(error)
      },
      "assistant run failed"
    );
    throw error;
  }
}
