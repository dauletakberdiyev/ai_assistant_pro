export type BusyBlockInput = {
  start?: string | null;
  end?: string | null;
};

export type CalendarConflict = {
  start_time: string;
  end_time: string;
};

export type SuggestedTimeSlot = {
  start_time: string;
  end_time: string;
};

type TimedBlock = {
  start: Date;
  end: Date;
};

function toTimedBlocks(blocks: BusyBlockInput[]): TimedBlock[] {
  return blocks
    .map((block) => {
      if (!block.start || !block.end) return undefined;
      const start = new Date(block.start);
      const end = new Date(block.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        return undefined;
      }
      return { start, end };
    })
    .filter((block): block is TimedBlock => Boolean(block))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

function mergeTimedBlocks(blocks: TimedBlock[]): TimedBlock[] {
  const merged: TimedBlock[] = [];

  for (const block of blocks) {
    const last = merged.at(-1);
    if (!last || block.start > last.end) {
      merged.push({ ...block });
      continue;
    }
    if (block.end > last.end) last.end = block.end;
  }

  return merged;
}

export function findCalendarConflicts(
  busyBlocks: BusyBlockInput[],
  startTime: Date,
  endTime: Date
): CalendarConflict[] {
  if (endTime <= startTime) {
    throw new Error("Calendar event end time must be after start time");
  }

  return toTimedBlocks(busyBlocks)
    .filter((block) => block.start < endTime && block.end > startTime)
    .map((block) => ({
      start_time: block.start.toISOString(),
      end_time: block.end.toISOString()
    }));
}

export function suggestAvailableTimeSlots(input: {
  busyBlocks: BusyBlockInput[];
  timeMin: Date;
  timeMax: Date;
  durationMinutes: number;
  maxSlots?: number;
}): SuggestedTimeSlot[] {
  if (input.timeMax <= input.timeMin) {
    throw new Error("Suggestion window end time must be after start time");
  }
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 15) {
    throw new Error("Duration must be at least 15 minutes");
  }

  const maxSlots = input.maxSlots ?? 5;
  const durationMs = input.durationMinutes * 60_000;
  const busy = mergeTimedBlocks(
    toTimedBlocks(input.busyBlocks)
      .filter((block) => block.end > input.timeMin && block.start < input.timeMax)
      .map((block) => ({
        start: block.start > input.timeMin ? block.start : input.timeMin,
        end: block.end < input.timeMax ? block.end : input.timeMax
      }))
  );

  const slots: SuggestedTimeSlot[] = [];
  let cursor = input.timeMin;

  for (const block of busy) {
    addSlots(slots, cursor, block.start, durationMs, maxSlots);
    if (slots.length >= maxSlots) return slots;
    if (block.end > cursor) cursor = block.end;
  }

  addSlots(slots, cursor, input.timeMax, durationMs, maxSlots);
  return slots;
}

function addSlots(
  slots: SuggestedTimeSlot[],
  freeStart: Date,
  freeEnd: Date,
  durationMs: number,
  maxSlots: number
) {
  let cursor = freeStart;

  while (slots.length < maxSlots && cursor.getTime() + durationMs <= freeEnd.getTime()) {
    const end = new Date(cursor.getTime() + durationMs);
    slots.push({
      start_time: cursor.toISOString(),
      end_time: end.toISOString()
    });
    cursor = end;
  }
}
