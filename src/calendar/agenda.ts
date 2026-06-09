import type { PrismaClient } from "@prisma/client";
import type { Env } from "../config/env.js";
import { getFreeBusy, listCalendarEvents } from "../google/calendar.js";

type CalendarDateValue = {
  date?: string | null;
  dateTime?: string | null;
  timeZone?: string | null;
};

export type AgendaEventInput = {
  id?: string | null;
  summary?: string | null;
  start?: CalendarDateValue | null;
  end?: CalendarDateValue | null;
  location?: string | null;
  description?: string | null;
};

export type AgendaBusyBlock = {
  start?: string | null;
  end?: string | null;
};

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
};

type LocalDateTimeParts = LocalDateParts & {
  hour: number;
  minute: number;
  second: number;
};

type TimedBlock = {
  start: Date;
  end: Date;
  title?: string;
};

export type DailyAgenda = {
  date: string;
  timezone: string;
  time_min: string;
  time_max: string;
  event_count: number;
  conflict_count: number;
  free_block_count: number;
  next_event?: {
    title: string;
    start_time: string;
    end_time: string;
  };
  free_busy_estimated: boolean;
  text: string;
};

function getLocalDateTimeParts(date: Date, timezone: string): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function parseOffsetMinutes(offset: string): number {
  if (offset === "GMT" || offset === "UTC") return 0;
  const match = offset.match(/(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  return sign * (hours * 60 + minutes);
}

function getTimeZoneOffsetMinutes(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset"
  }).formatToParts(date);
  const offset = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  return parseOffsetMinutes(offset);
}

function zonedTimeToUtc(parts: LocalDateTimeParts, timezone: string): Date {
  const localUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  let utcMs = localUtcMs - getTimeZoneOffsetMinutes(new Date(localUtcMs), timezone) * 60_000;
  utcMs = localUtcMs - getTimeZoneOffsetMinutes(new Date(utcMs), timezone) * 60_000;
  return new Date(utcMs);
}

function addLocalDays(parts: LocalDateParts, days: number): LocalDateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function parseLocalDate(date: string): LocalDateParts {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("Agenda date must use YYYY-MM-DD format");
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

export function localDayKey(date: Date, timezone: string): string {
  const parts = getLocalDateTimeParts(date, timezone);
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0")
  ].join("-");
}

export function localHourMinute(date: Date, timezone: string) {
  const parts = getLocalDateTimeParts(date, timezone);
  return { hour: parts.hour, minute: parts.minute };
}

export function buildAgendaWindow(
  timezone: string,
  input: { date?: string; referenceDate?: Date } = {}
) {
  const localDate = input.date
    ? parseLocalDate(input.date)
    : getLocalDateTimeParts(input.referenceDate ?? new Date(), timezone);
  const nextLocalDate = addLocalDays(localDate, 1);
  const start = zonedTimeToUtc({ ...localDate, hour: 0, minute: 0, second: 0 }, timezone);
  const end = zonedTimeToUtc({ ...nextLocalDate, hour: 0, minute: 0, second: 0 }, timezone);

  return {
    date: [
      String(localDate.year).padStart(4, "0"),
      String(localDate.month).padStart(2, "0"),
      String(localDate.day).padStart(2, "0")
    ].join("-"),
    start,
    end
  };
}

function parseEventDate(value: CalendarDateValue | null | undefined, timezone: string) {
  if (!value) return undefined;
  if (value.dateTime) return { date: new Date(value.dateTime), allDay: false };
  if (value.date) {
    const localDate = parseLocalDate(value.date);
    return {
      date: zonedTimeToUtc({ ...localDate, hour: 0, minute: 0, second: 0 }, timezone),
      allDay: true
    };
  }
  return undefined;
}

function formatTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

function formatDateLabel(date: string, timezone: string): string {
  const window = buildAgendaWindow(timezone, { date });
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(window.start);
}

function formatDuration(start: Date, end: Date): string {
  const totalMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

function mergeBlocks(blocks: TimedBlock[]): TimedBlock[] {
  const sorted = [...blocks].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: TimedBlock[] = [];

  for (const block of sorted) {
    const last = merged.at(-1);
    if (!last || block.start > last.end) {
      merged.push({ ...block });
      continue;
    }
    if (block.end > last.end) last.end = block.end;
  }

  return merged;
}

function clampBlock(block: TimedBlock, start: Date, end: Date): TimedBlock | undefined {
  const clampedStart = block.start > start ? block.start : start;
  const clampedEnd = block.end < end ? block.end : end;
  if (clampedEnd <= clampedStart) return undefined;
  return { ...block, start: clampedStart, end: clampedEnd };
}

function getWorkdayBounds(date: string, timezone: string) {
  const localDate = parseLocalDate(date);
  return {
    start: zonedTimeToUtc({ ...localDate, hour: 9, minute: 0, second: 0 }, timezone),
    end: zonedTimeToUtc({ ...localDate, hour: 18, minute: 0, second: 0 }, timezone)
  };
}

function getFreeBlocks(
  busyBlocks: AgendaBusyBlock[],
  date: string,
  timezone: string,
  now: Date
): TimedBlock[] {
  const workday = getWorkdayBounds(date, timezone);
  const floor = localDayKey(now, timezone) === date && now > workday.start ? now : workday.start;
  if (floor >= workday.end) return [];

  const busy = mergeBlocks(
    busyBlocks
      .map((block) => {
        if (!block.start || !block.end) return undefined;
        return clampBlock({ start: new Date(block.start), end: new Date(block.end) }, floor, workday.end);
      })
      .filter((block): block is TimedBlock => Boolean(block))
  );

  const free: TimedBlock[] = [];
  let cursor = floor;

  for (const block of busy) {
    if (block.start > cursor) free.push({ start: cursor, end: block.start });
    if (block.end > cursor) cursor = block.end;
  }

  if (cursor < workday.end) free.push({ start: cursor, end: workday.end });
  return free.filter((block) => block.end.getTime() - block.start.getTime() >= 30 * 60_000);
}

function getTimedEvents(events: AgendaEventInput[], timezone: string): TimedBlock[] {
  const timedEvents: TimedBlock[] = [];

  for (const event of events) {
    const start = parseEventDate(event.start, timezone);
    const end = parseEventDate(event.end, timezone);
    if (!start || !end || start.allDay || end.allDay || end.date <= start.date) continue;

    timedEvents.push({
      start: start.date,
      end: end.date,
      title: event.summary ?? "Untitled event"
    });
  }

  return timedEvents.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function deriveBusyBlocksFromEvents(
  events: AgendaEventInput[],
  timezone: string
): AgendaBusyBlock[] {
  return getTimedEvents(events, timezone).map((event) => ({
    start: event.start.toISOString(),
    end: event.end.toISOString()
  }));
}

function isInsufficientPermissionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as { code?: unknown; status?: unknown }).code ?? (error as { status?: unknown }).status;
  return (
    status === 403 ||
    error.message.toLowerCase().includes("insufficient permission") ||
    error.message.toLowerCase().includes("insufficient authentication scopes")
  );
}

function getConflictLines(events: TimedBlock[], timezone: string): string[] {
  const conflicts: string[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const current = events[index];
    const next = events[index + 1];
    if (!current || !next || next.start >= current.end) continue;

    const overlapEnd = next.end < current.end ? next.end : current.end;
    conflicts.push(
      `${formatTime(next.start, timezone)}-${formatTime(overlapEnd, timezone)}: ${
        current.title ?? "Event"
      } overlaps ${next.title ?? "event"}`
    );
  }
  return conflicts;
}

function formatEventLine(event: AgendaEventInput, timezone: string): string {
  const title = event.summary ?? "Untitled event";
  const start = parseEventDate(event.start, timezone);
  const end = parseEventDate(event.end, timezone);
  const location = event.location ? ` @ ${event.location}` : "";

  if (!start) return `- Time unknown: ${title}${location}`;
  if (start.allDay) return `- All day: ${title}${location}`;
  if (!end) return `- ${formatTime(start.date, timezone)}: ${title}${location}`;
  return `- ${formatTime(start.date, timezone)}-${formatTime(end.date, timezone)}: ${title}${location}`;
}

export function summarizeDailyAgenda(input: {
  date: string;
  timezone: string;
  timeMin: Date;
  timeMax: Date;
  events: AgendaEventInput[];
  busy: AgendaBusyBlock[];
  freeBusyEstimated?: boolean;
  now?: Date;
}): DailyAgenda {
  const now = input.now ?? new Date();
  const timedEvents = getTimedEvents(input.events, input.timezone);
  const upcoming = timedEvents.find((event) => event.end > now);
  const freeBlocks = getFreeBlocks(input.busy, input.date, input.timezone, now);
  const conflictLines = getConflictLines(timedEvents, input.timezone);

  const lines = [`Agenda for ${formatDateLabel(input.date, input.timezone)} (${input.timezone})`];

  if (input.events.length === 0) {
    lines.push("No events scheduled.");
  } else {
    lines.push("Events:");
    for (const event of input.events) lines.push(formatEventLine(event, input.timezone));
  }

  if (conflictLines.length > 0) {
    lines.push("", "Conflicts:");
    for (const conflict of conflictLines) lines.push(`- ${conflict}`);
  }

  lines.push("", "Free work blocks:");
  if (input.freeBusyEstimated) {
    lines.push("- Estimated from visible calendar events. Reconnect Google Calendar to enable FreeBusy.");
  }
  if (freeBlocks.length === 0) {
    lines.push("- No open blocks of 30 minutes or more between 09:00 and 18:00.");
  } else {
    for (const block of freeBlocks) {
      lines.push(
        `- ${formatTime(block.start, input.timezone)}-${formatTime(block.end, input.timezone)} (${formatDuration(
          block.start,
          block.end
        )})`
      );
    }
  }

  if (upcoming) {
    lines.push(
      "",
      `Next up: ${formatTime(upcoming.start, input.timezone)} ${upcoming.title ?? "calendar event"}`
    );
  }

  return {
    date: input.date,
    timezone: input.timezone,
    time_min: input.timeMin.toISOString(),
    time_max: input.timeMax.toISOString(),
    event_count: input.events.length,
    conflict_count: conflictLines.length,
    free_block_count: freeBlocks.length,
    free_busy_estimated: input.freeBusyEstimated ?? false,
    next_event: upcoming
      ? {
          title: upcoming.title ?? "Untitled event",
          start_time: upcoming.start.toISOString(),
          end_time: upcoming.end.toISOString()
        }
      : undefined,
    text: lines.join("\n")
  };
}

export async function buildDailyAgenda(
  db: PrismaClient,
  env: Env,
  userId: string,
  input: { date?: string; now?: Date } = {}
): Promise<DailyAgenda> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const window = buildAgendaWindow(user.timezone, {
    date: input.date,
    referenceDate: input.now
  });
  const events = await listCalendarEvents(db, env, userId, {
    timeMin: window.start.toISOString(),
    timeMax: window.end.toISOString(),
    maxResults: 50
  });

  let freeBusyEstimated = false;
  let busy: AgendaBusyBlock[];
  try {
    busy = await getFreeBusy(db, env, userId, {
      timeMin: window.start.toISOString(),
      timeMax: window.end.toISOString()
    });
  } catch (error) {
    if (!isInsufficientPermissionError(error)) throw error;
    freeBusyEstimated = true;
    busy = deriveBusyBlocksFromEvents(events, user.timezone);
  }

  return summarizeDailyAgenda({
    date: window.date,
    timezone: user.timezone,
    timeMin: window.start,
    timeMax: window.end,
    events,
    busy,
    freeBusyEstimated,
    now: input.now
  });
}
