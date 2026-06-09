import { describe, expect, it } from "vitest";
import { buildAgendaWindow, deriveBusyBlocksFromEvents, summarizeDailyAgenda } from "../calendar/agenda.js";
import { shouldSendDailyAgenda as shouldRunDailyAgendaCheckIn } from "../calendar/checkins.js";

describe("daily agenda intelligence", () => {
  it("builds local day windows in the user's timezone", () => {
    const window = buildAgendaWindow("Asia/Almaty", { date: "2026-06-05" });

    expect(window.date).toBe("2026-06-05");
    expect(window.start.toISOString()).toBe("2026-06-04T19:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-06-05T19:00:00.000Z");
  });

  it("summarizes events, conflicts, free blocks, and next event", () => {
    const agenda = summarizeDailyAgenda({
      date: "2026-06-05",
      timezone: "Asia/Almaty",
      timeMin: new Date("2026-06-04T19:00:00.000Z"),
      timeMax: new Date("2026-06-05T19:00:00.000Z"),
      now: new Date("2026-06-05T02:00:00.000Z"),
      events: [
        {
          summary: "Standup",
          start: { dateTime: "2026-06-05T09:00:00+05:00" },
          end: { dateTime: "2026-06-05T10:00:00+05:00" }
        },
        {
          summary: "Planning",
          start: { dateTime: "2026-06-05T09:30:00+05:00" },
          end: { dateTime: "2026-06-05T10:30:00+05:00" }
        }
      ],
      busy: [{ start: "2026-06-05T04:00:00.000Z", end: "2026-06-05T05:30:00.000Z" }]
    });

    expect(agenda.event_count).toBe(2);
    expect(agenda.conflict_count).toBe(1);
    expect(agenda.free_block_count).toBeGreaterThan(0);
    expect(agenda.text).toContain("Conflicts:");
    expect(agenda.text).toContain("Next up:");
  });

  it("only sends one opt-in daily agenda per local day", () => {
    const user = {
      dailyAgendaEnabled: true,
      telegramChatId: "123",
      dailyAgendaHour: 8,
      timezone: "Asia/Almaty",
      lastDailyAgendaSentAt: new Date("2026-06-04T02:00:00.000Z")
    } as any;

    expect(shouldRunDailyAgendaCheckIn(user, new Date("2026-06-05T03:00:00.000Z"))).toBe(true);

    user.lastDailyAgendaSentAt = new Date("2026-06-05T03:00:00.000Z");
    expect(shouldRunDailyAgendaCheckIn(user, new Date("2026-06-05T03:05:00.000Z"))).toBe(false);
  });

  it("can estimate busy blocks from visible events when free/busy is unavailable", () => {
    const busy = deriveBusyBlocksFromEvents(
      [
        {
          summary: "Standup",
          start: { dateTime: "2026-06-05T09:00:00+05:00" },
          end: { dateTime: "2026-06-05T10:00:00+05:00" }
        },
        {
          summary: "Holiday",
          start: { date: "2026-06-05" },
          end: { date: "2026-06-06" }
        }
      ],
      "Asia/Almaty"
    );

    expect(busy).toEqual([
      {
        start: "2026-06-05T04:00:00.000Z",
        end: "2026-06-05T05:00:00.000Z"
      }
    ]);
  });
});
