import { describe, expect, it } from "vitest";
import {
  deleteUserPreferenceSchema,
  draftUpdateCalendarEventSchema,
  draftCalendarEventSchema,
  getDailyAgendaSchema,
  getFreeBusySchema,
  listCalendarEventsSchema,
  suggestTimeSlotsSchema,
  updateUserPreferenceSchema
} from "../assistant/toolSchemas.js";

describe("calendar tool schemas", () => {
  it("validates list_calendar_events input", () => {
    const input = listCalendarEventsSchema.parse({
      time_min: "2026-06-01T09:00:00+05:00",
      time_max: "2026-06-01T18:00:00+05:00"
    });

    expect(input.max_results).toBe(10);
  });

  it("rejects invalid free/busy date-times", () => {
    expect(() =>
      getFreeBusySchema.parse({
        time_min: "tomorrow morning",
        time_max: "2026-06-01T18:00:00+05:00"
      })
    ).toThrow();
  });

  it("validates daily agenda dates", () => {
    expect(getDailyAgendaSchema.parse({ date: "2026-06-05" }).date).toBe("2026-06-05");
    expect(() => getDailyAgendaSchema.parse({ date: "June 5" })).toThrow();
  });

  it("validates suggest_time_slots input", () => {
    const input = suggestTimeSlotsSchema.parse({
      time_min: "2026-06-05T09:00:00+05:00",
      time_max: "2026-06-05T18:00:00+05:00",
      duration_minutes: 45,
      timezone: "Asia/Almaty"
    });

    expect(input.max_slots).toBe(5);
  });

  it("validates draft_calendar_event input", () => {
    const input = draftCalendarEventSchema.parse({
      title: "Gym",
      start_time: "2026-06-02T19:00:00+05:00",
      end_time: "2026-06-02T20:00:00+05:00",
      timezone: "Asia/Almaty",
      recurrence_rule: "RRULE:FREQ=WEEKLY;COUNT=4"
    });

    expect(input.title).toBe("Gym");
    expect(input.recurrence_rule).toBe("RRULE:FREQ=WEEKLY;COUNT=4");
  });

  it("validates draft_update_calendar_event input", () => {
    const input = draftUpdateCalendarEventSchema.parse({
      event_id: "google_event_1",
      current_title: "Gym",
      new_start_time: "2026-06-02T20:00:00+05:00",
      new_end_time: "2026-06-02T21:00:00+05:00",
      timezone: "Asia/Almaty",
      new_recurrence_rule: "RRULE:FREQ=WEEKLY;UNTIL=20260701T000000Z"
    });

    expect(input.event_id).toBe("google_event_1");
    expect(input.new_recurrence_rule).toBe("RRULE:FREQ=WEEKLY;UNTIL=20260701T000000Z");
  });

  it("rejects recurrence rules that are not RRULE strings", () => {
    expect(() =>
      draftCalendarEventSchema.parse({
        title: "Gym",
        start_time: "2026-06-02T19:00:00+05:00",
        end_time: "2026-06-02T20:00:00+05:00",
        timezone: "Asia/Almaty",
        recurrence_rule: "weekly"
      })
    ).toThrow();
  });

  it("rejects update drafts without changes", () => {
    expect(() =>
      draftUpdateCalendarEventSchema.parse({
        event_id: "google_event_1",
        current_title: "Gym",
        timezone: "Asia/Almaty"
      })
    ).toThrow();
  });

  it("validates preference tool inputs", () => {
    const input = updateUserPreferenceSchema.parse({
      key: "default_meeting_duration_minutes",
      value: "45"
    });

    expect(input.key).toBe("default_meeting_duration_minutes");
    expect(deleteUserPreferenceSchema.parse({ key: "working_hours_start" }).key).toBe(
      "working_hours_start"
    );
    expect(() =>
      updateUserPreferenceSchema.parse({
        key: "favorite_snack",
        value: "raisins"
      })
    ).toThrow();
  });
});
