import { describe, expect, it, vi } from "vitest";
import {
  expandCalendarOccurrences,
  findRecurringCalendarConflicts,
  isValidRecurrenceRule
} from "../calendar/recurrence.js";
import { executeAssistantTool } from "../assistant/tools.js";
import { getFreeBusy } from "../google/calendar.js";

vi.mock("../google/calendar.js", () => ({
  getFreeBusy: vi.fn(),
  listCalendarEvents: vi.fn()
}));

const contextBase = {
  env: {} as any,
  userId: "user_1",
  assistantRunId: "run_1",
  pendingDrafts: [],
  pendingCancellationDrafts: [],
  pendingUpdateDrafts: [],
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
};

describe("calendar recurrence hardening", () => {
  it("validates and expands RRULE strings within the safety bound", () => {
    expect(isValidRecurrenceRule("RRULE:FREQ=WEEKLY;COUNT=4")).toBe(true);
    expect(isValidRecurrenceRule("RRULE:FREQ=NOPE")).toBe(false);

    const expansion = expandCalendarOccurrences({
      startTime: new Date("2026-06-02T14:00:00.000Z"),
      endTime: new Date("2026-06-02T15:00:00.000Z"),
      recurrenceRule: "RRULE:FREQ=WEEKLY;COUNT=4"
    });

    expect(expansion.occurrences.map((date) => date.toISOString())).toEqual([
      "2026-06-02T14:00:00.000Z",
      "2026-06-09T14:00:00.000Z",
      "2026-06-16T14:00:00.000Z",
      "2026-06-23T14:00:00.000Z"
    ]);
  });

  it("finds conflicts on later recurring occurrences", () => {
    const result = findRecurringCalendarConflicts({
      busyBlocks: [
        {
          start: "2026-06-09T14:30:00.000Z",
          end: "2026-06-09T15:30:00.000Z"
        }
      ],
      startTime: new Date("2026-06-02T14:00:00.000Z"),
      endTime: new Date("2026-06-02T15:00:00.000Z"),
      recurrenceRule: "RRULE:FREQ=WEEKLY;COUNT=4"
    });

    expect(result.conflicts).toEqual([
      {
        occurrence_start_time: "2026-06-09T14:00:00.000Z",
        occurrence_end_time: "2026-06-09T15:00:00.000Z",
        busy_start_time: "2026-06-09T14:30:00.000Z",
        busy_end_time: "2026-06-09T15:30:00.000Z"
      }
    ]);
  });

  it("blocks recurring draft creation when a later occurrence conflicts", async () => {
    vi.mocked(getFreeBusy).mockResolvedValueOnce([
      {
        start: "2026-06-09T14:30:00.000Z",
        end: "2026-06-09T15:30:00.000Z"
      }
    ]);
    const create = vi.fn();
    const db = {
      toolCall: { create: vi.fn() },
      calendarEventDraft: { create }
    } as any;

    const result = await executeAssistantTool(
      "draft_calendar_event",
      {
        title: "Gym",
        start_time: "2026-06-02T19:00:00+05:00",
        end_time: "2026-06-02T20:00:00+05:00",
        timezone: "Asia/Almaty",
        recurrence_rule: "RRULE:FREQ=WEEKLY;COUNT=4"
      },
      { ...contextBase, db }
    );

    expect(result.ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a recurring draft when bounded occurrences do not conflict", async () => {
    vi.mocked(getFreeBusy).mockResolvedValueOnce([]);
    const create = vi.fn(async ({ data }) => ({ id: "draft_1", ...data }));
    const db = {
      toolCall: { create: vi.fn() },
      calendarEventDraft: { create }
    } as any;
    const pendingDrafts: any[] = [];

    const result = await executeAssistantTool(
      "draft_calendar_event",
      {
        title: "Gym",
        start_time: "2026-06-02T19:00:00+05:00",
        end_time: "2026-06-02T20:00:00+05:00",
        timezone: "Asia/Almaty",
        recurrence_rule: "RRULE:FREQ=WEEKLY;COUNT=4"
      },
      { ...contextBase, db, pendingDrafts }
    );

    expect(result.ok).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    expect(pendingDrafts).toHaveLength(1);
  });

  it("uses saved default meeting duration for slot suggestions", async () => {
    vi.mocked(getFreeBusy).mockResolvedValueOnce([]);
    const db = {
      toolCall: { create: vi.fn() },
      userPreference: {
        findMany: vi.fn(async () => [
          {
            key: "default_meeting_duration_minutes",
            value: "45"
          }
        ])
      }
    } as any;

    const result = await executeAssistantTool(
      "suggest_time_slots",
      {
        time_min: "2026-06-05T09:00:00+05:00",
        time_max: "2026-06-05T11:00:00+05:00",
        timezone: "Asia/Almaty"
      },
      { ...contextBase, db }
    );

    const slotResult = result as {
      ok: true;
      duration_minutes: number;
      slots: Array<{ start_time: string; end_time: string }>;
    };

    expect(slotResult.ok).toBe(true);
    expect(slotResult.duration_minutes).toBe(45);
    expect(slotResult.slots[0]).toEqual({
      start_time: "2026-06-05T04:00:00.000Z",
      end_time: "2026-06-05T04:45:00.000Z"
    });
  });
});
