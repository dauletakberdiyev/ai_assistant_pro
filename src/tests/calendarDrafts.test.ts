import { describe, expect, it, vi } from "vitest";
import {
  CANCELLATION_STATUS,
  confirmCalendarCancellationDraftWithClient,
  createCalendarCancellationDraft
} from "../calendar/cancellations.js";
import {
  DRAFT_STATUS,
  confirmCalendarEventDraftWithClient,
  createCalendarEventDraft
} from "../calendar/drafts.js";
import {
  UPDATE_STATUS,
  confirmCalendarUpdateDraftWithClient,
  createCalendarUpdateDraft
} from "../calendar/updates.js";

describe("calendar event drafts", () => {
  it("draft_calendar_event stores a pending draft without calling Google Calendar", async () => {
    const create = vi.fn(async ({ data }) => ({ id: "draft_1", ...data }));
    const db = {
      calendarEventDraft: { create }
    } as any;

    const draft = await createCalendarEventDraft(db, "user_1", {
      title: "Gym",
      startTime: new Date("2026-06-02T14:00:00.000Z"),
      endTime: new Date("2026-06-02T15:00:00.000Z"),
      timezone: "Asia/Almaty",
      recurrenceRule: "RRULE:FREQ=WEEKLY;COUNT=4"
    });

    expect(create).toHaveBeenCalledOnce();
    expect(draft.status).toBe(DRAFT_STATUS.Pending);
    expect(draft.recurrenceRule).toBe("RRULE:FREQ=WEEKLY;COUNT=4");
  });

  it("confirmCalendarEventDraftWithClient only confirms existing pending drafts", async () => {
    const db = {
      calendarEventDraft: {
        findFirst: vi.fn(async () => null),
        update: vi.fn()
      }
    } as any;
    const calendar = {
      events: {
        insert: vi.fn()
      }
    } as any;

    await expect(
      confirmCalendarEventDraftWithClient(db, calendar, "user_1", "missing_draft")
    ).rejects.toThrow("Pending calendar event draft was not found");
    expect(calendar.events.insert).not.toHaveBeenCalled();
    expect(db.calendarEventDraft.update).not.toHaveBeenCalled();
  });
});

describe("calendar cancellation drafts", () => {
  it("draft_cancel_calendar_event stores a pending deletion draft without deleting", async () => {
    const create = vi.fn(async ({ data }) => ({ id: "cancel_draft_1", ...data }));
    const db = {
      calendarEventCancellationDraft: { create }
    } as any;

    const draft = await createCalendarCancellationDraft(db, "user_1", {
      googleEventId: "google_event_1",
      title: "Gym",
      startTime: new Date("2026-06-04T14:00:00.000Z"),
      endTime: new Date("2026-06-04T15:00:00.000Z"),
      timezone: "Asia/Almaty"
    });

    expect(create).toHaveBeenCalledOnce();
    expect(draft.status).toBe(CANCELLATION_STATUS.Pending);
  });

  it("confirmCalendarCancellationDraftWithClient only deletes existing pending drafts", async () => {
    const db = {
      calendarEventCancellationDraft: {
        findFirst: vi.fn(async () => null),
        update: vi.fn()
      }
    } as any;
    const calendar = {
      events: {
        delete: vi.fn()
      }
    } as any;

    await expect(
      confirmCalendarCancellationDraftWithClient(db, calendar, "user_1", "missing_draft")
    ).rejects.toThrow("Pending calendar cancellation draft was not found");
    expect(calendar.events.delete).not.toHaveBeenCalled();
    expect(db.calendarEventCancellationDraft.update).not.toHaveBeenCalled();
  });
});

describe("calendar update drafts", () => {
  it("draft_update_calendar_event stores a pending update draft without patching", async () => {
    const create = vi.fn(async ({ data }) => ({ id: "update_draft_1", ...data }));
    const db = {
      calendarEventUpdateDraft: { create }
    } as any;

    const draft = await createCalendarUpdateDraft(db, "user_1", {
      googleEventId: "google_event_1",
      currentTitle: "Gym",
      newStartTime: new Date("2026-06-04T15:00:00.000Z"),
      newEndTime: new Date("2026-06-04T16:00:00.000Z"),
      timezone: "Asia/Almaty",
      newRecurrenceRule: "RRULE:FREQ=WEEKLY;COUNT=6"
    });

    expect(create).toHaveBeenCalledOnce();
    expect(draft.status).toBe(UPDATE_STATUS.Pending);
    expect(draft.newRecurrenceRule).toBe("RRULE:FREQ=WEEKLY;COUNT=6");
  });

  it("confirmCalendarUpdateDraftWithClient only patches existing pending drafts", async () => {
    const db = {
      calendarEventUpdateDraft: {
        findFirst: vi.fn(async () => null),
        update: vi.fn()
      }
    } as any;
    const calendar = {
      events: {
        patch: vi.fn()
      }
    } as any;

    await expect(
      confirmCalendarUpdateDraftWithClient(db, calendar, "user_1", "missing_draft")
    ).rejects.toThrow("Pending calendar update draft was not found");
    expect(calendar.events.patch).not.toHaveBeenCalled();
    expect(db.calendarEventUpdateDraft.update).not.toHaveBeenCalled();
  });

  it("rejects time update drafts missing an end time", async () => {
    const db = {
      calendarEventUpdateDraft: { create: vi.fn() }
    } as any;

    await expect(
      createCalendarUpdateDraft(db, "user_1", {
        googleEventId: "google_event_1",
        currentTitle: "Gym",
        newStartTime: new Date("2026-06-04T15:00:00.000Z"),
        timezone: "Asia/Almaty"
      })
    ).rejects.toThrow("Calendar event time updates must include both start and end time");
    expect(db.calendarEventUpdateDraft.create).not.toHaveBeenCalled();
  });
});
