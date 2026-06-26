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

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};

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
        updateMany: vi.fn(async () => ({ count: 0 })),
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
      confirmCalendarEventDraftWithClient(db, calendar, "user_1", "missing_draft", silentLogger)
    ).rejects.toThrow("Pending calendar event draft was not found");
    expect(calendar.events.insert).not.toHaveBeenCalled();
    expect(db.calendarEventDraft.update).not.toHaveBeenCalled();
  });

  it("confirmCalendarEventDraftWithClient is idempotent after a draft is confirmed", async () => {
    let storedDraft = {
      id: "draft_1",
      userId: "user_1",
      status: DRAFT_STATUS.Pending,
      title: "Gym",
      startTime: new Date("2026-06-02T14:00:00.000Z"),
      endTime: new Date("2026-06-02T15:00:00.000Z"),
      timezone: "Asia/Almaty",
      description: null,
      location: null,
      recurrenceRule: null,
      googleEventId: null
    };
    const db = {
      calendarEventDraft: {
        updateMany: vi.fn(async ({ where, data }) => {
          if (storedDraft.id === where.id && storedDraft.status === where.status) {
            storedDraft = { ...storedDraft, ...data };
            return { count: 1 };
          }
          return { count: 0 };
        }),
        findFirst: vi.fn(async ({ where }) => {
          if (where.status && storedDraft.status !== where.status) return null;
          return storedDraft;
        }),
        update: vi.fn(async ({ data }) => {
          storedDraft = { ...storedDraft, ...data };
          return storedDraft;
        })
      }
    } as any;
    const calendar = {
      events: {
        insert: vi.fn(async () => ({ data: { id: "google_event_1", summary: "Gym" } }))
      }
    } as any;

    const first = await confirmCalendarEventDraftWithClient(
      db,
      calendar,
      "user_1",
      "draft_1",
      silentLogger
    );
    const second = await confirmCalendarEventDraftWithClient(
      db,
      calendar,
      "user_1",
      "draft_1",
      silentLogger
    );

    expect(calendar.events.insert).toHaveBeenCalledOnce();
    expect(calendar.events.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          extendedProperties: { private: { assistantDraftId: "draft_1" } }
        })
      })
    );
    expect(first.alreadyProcessed).toBe(false);
    expect(second.alreadyProcessed).toBe(true);
    expect(second.event.id).toBe("google_event_1");
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
        updateMany: vi.fn(async () => ({ count: 0 })),
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
      confirmCalendarCancellationDraftWithClient(
        db,
        calendar,
        "user_1",
        "missing_draft",
        silentLogger
      )
    ).rejects.toThrow("Pending calendar cancellation draft was not found");
    expect(calendar.events.delete).not.toHaveBeenCalled();
    expect(db.calendarEventCancellationDraft.update).not.toHaveBeenCalled();
  });

  it("confirmCalendarCancellationDraftWithClient does not delete twice", async () => {
    let storedDraft = {
      id: "cancel_draft_1",
      userId: "user_1",
      status: CANCELLATION_STATUS.Pending,
      googleEventId: "google_event_1",
      title: "Gym",
      startTime: null,
      endTime: null,
      timezone: "Asia/Almaty"
    };
    const db = {
      calendarEventCancellationDraft: {
        updateMany: vi.fn(async ({ where, data }) => {
          if (storedDraft.id === where.id && storedDraft.status === where.status) {
            storedDraft = { ...storedDraft, ...data };
            return { count: 1 };
          }
          return { count: 0 };
        }),
        findFirst: vi.fn(async ({ where }) => {
          if (where.status && storedDraft.status !== where.status) return null;
          return storedDraft;
        }),
        update: vi.fn(async ({ data }) => {
          storedDraft = { ...storedDraft, ...data };
          return storedDraft;
        })
      }
    } as any;
    const calendar = { events: { delete: vi.fn(async () => ({})) } } as any;

    await confirmCalendarCancellationDraftWithClient(
      db,
      calendar,
      "user_1",
      "cancel_draft_1",
      silentLogger
    );
    const second = await confirmCalendarCancellationDraftWithClient(
      db,
      calendar,
      "user_1",
      "cancel_draft_1",
      silentLogger
    );

    expect(calendar.events.delete).toHaveBeenCalledOnce();
    expect(second.alreadyProcessed).toBe(true);
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
        updateMany: vi.fn(async () => ({ count: 0 })),
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
      confirmCalendarUpdateDraftWithClient(db, calendar, "user_1", "missing_draft", silentLogger)
    ).rejects.toThrow("Pending calendar update draft was not found");
    expect(calendar.events.patch).not.toHaveBeenCalled();
    expect(db.calendarEventUpdateDraft.update).not.toHaveBeenCalled();
  });

  it("confirmCalendarUpdateDraftWithClient does not patch twice", async () => {
    let storedDraft = {
      id: "update_draft_1",
      userId: "user_1",
      status: UPDATE_STATUS.Pending,
      googleEventId: "google_event_1",
      currentTitle: "Gym",
      newTitle: "Training",
      newStartTime: null,
      newEndTime: null,
      timezone: "Asia/Almaty",
      newDescription: null,
      newLocation: null,
      newRecurrenceRule: null
    };
    const db = {
      calendarEventUpdateDraft: {
        updateMany: vi.fn(async ({ where, data }) => {
          if (storedDraft.id === where.id && storedDraft.status === where.status) {
            storedDraft = { ...storedDraft, ...data };
            return { count: 1 };
          }
          return { count: 0 };
        }),
        findFirst: vi.fn(async ({ where }) => {
          if (where.status && storedDraft.status !== where.status) return null;
          return storedDraft;
        }),
        update: vi.fn(async ({ data }) => {
          storedDraft = { ...storedDraft, ...data };
          return storedDraft;
        })
      }
    } as any;
    const calendar = {
      events: { patch: vi.fn(async () => ({ data: { id: "google_event_1", summary: "Training" } })) }
    } as any;

    await confirmCalendarUpdateDraftWithClient(
      db,
      calendar,
      "user_1",
      "update_draft_1",
      silentLogger
    );
    const second = await confirmCalendarUpdateDraftWithClient(
      db,
      calendar,
      "user_1",
      "update_draft_1",
      silentLogger
    );

    expect(calendar.events.patch).toHaveBeenCalledOnce();
    expect(second.alreadyProcessed).toBe(true);
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
