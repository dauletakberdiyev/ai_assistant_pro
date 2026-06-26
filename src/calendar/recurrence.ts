import rrulePackage from "rrule";
import type { AgendaBusyBlock } from "./agenda.js";
import { findCalendarConflicts } from "./intelligence.js";

const { rrulestr } = rrulePackage;

export const RECURRENCE_CHECK_MONTHS = 6;
export const RECURRENCE_CHECK_MAX_OCCURRENCES = 50;

export type RecurrenceExpansion = {
  occurrences: Date[];
  checkedUntil: Date;
  bounded: boolean;
};

export type RecurringCalendarConflict = {
  occurrence_start_time: string;
  occurrence_end_time: string;
  busy_start_time: string;
  busy_end_time: string;
};

export function parseRecurrenceRule(rule: string, startTime: Date) {
  const normalized = rule.trim();
  if (!/^RRULE:/i.test(normalized)) {
    throw new Error("Use an RFC 5545 RRULE string starting with RRULE:");
  }
  return rrulestr(normalized, { dtstart: startTime });
}

export function isValidRecurrenceRule(rule: string): boolean {
  try {
    parseRecurrenceRule(rule, new Date("2026-01-01T00:00:00.000Z"));
    return true;
  } catch {
    return false;
  }
}

function addUtcMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

export function expandCalendarOccurrences(input: {
  startTime: Date;
  endTime: Date;
  recurrenceRule?: string;
}): RecurrenceExpansion {
  if (input.endTime <= input.startTime) {
    throw new Error("Calendar event end time must be after start time");
  }

  if (!input.recurrenceRule) {
    return { occurrences: [input.startTime], checkedUntil: input.endTime, bounded: false };
  }

  const rule = parseRecurrenceRule(input.recurrenceRule, input.startTime);
  const horizon = addUtcMonths(input.startTime, RECURRENCE_CHECK_MONTHS);
  const after = new Date(input.startTime.getTime() - 1);
  const occurrences = rule.between(after, horizon, true, (_date, len) => {
    return len < RECURRENCE_CHECK_MAX_OCCURRENCES;
  });

  return {
    occurrences,
    checkedUntil: horizon,
    bounded: true
  };
}

export function getOccurrenceWindow(input: {
  startTime: Date;
  endTime: Date;
  recurrenceRule?: string;
}): { timeMin: Date; timeMax: Date; expansion: RecurrenceExpansion } {
  const expansion = expandCalendarOccurrences(input);
  const durationMs = input.endTime.getTime() - input.startTime.getTime();
  const lastOccurrence = expansion.occurrences.at(-1) ?? input.startTime;
  return {
    timeMin: input.startTime,
    timeMax: new Date(lastOccurrence.getTime() + durationMs),
    expansion
  };
}

export function findRecurringCalendarConflicts(input: {
  busyBlocks: AgendaBusyBlock[];
  startTime: Date;
  endTime: Date;
  recurrenceRule?: string;
}): { conflicts: RecurringCalendarConflict[]; expansion: RecurrenceExpansion } {
  const expansion = expandCalendarOccurrences(input);
  const durationMs = input.endTime.getTime() - input.startTime.getTime();
  const conflicts: RecurringCalendarConflict[] = [];

  for (const occurrence of expansion.occurrences) {
    const occurrenceEnd = new Date(occurrence.getTime() + durationMs);
    for (const conflict of findCalendarConflicts(input.busyBlocks, occurrence, occurrenceEnd)) {
      conflicts.push({
        occurrence_start_time: occurrence.toISOString(),
        occurrence_end_time: occurrenceEnd.toISOString(),
        busy_start_time: conflict.start_time,
        busy_end_time: conflict.end_time
      });
    }
  }

  return { conflicts, expansion };
}
