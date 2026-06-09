import { describe, expect, it } from "vitest";
import {
  findCalendarConflicts,
  suggestAvailableTimeSlots
} from "../calendar/intelligence.js";

describe("calendar scheduling intelligence", () => {
  it("finds busy blocks that overlap a requested event", () => {
    const conflicts = findCalendarConflicts(
      [
        {
          start: "2026-06-05T04:00:00.000Z",
          end: "2026-06-05T05:00:00.000Z"
        },
        {
          start: "2026-06-05T07:00:00.000Z",
          end: "2026-06-05T08:00:00.000Z"
        }
      ],
      new Date("2026-06-05T04:30:00.000Z"),
      new Date("2026-06-05T05:30:00.000Z")
    );

    expect(conflicts).toEqual([
      {
        start_time: "2026-06-05T04:00:00.000Z",
        end_time: "2026-06-05T05:00:00.000Z"
      }
    ]);
  });

  it("suggests slots around merged busy blocks", () => {
    const slots = suggestAvailableTimeSlots({
      busyBlocks: [
        {
          start: "2026-06-05T10:00:00.000Z",
          end: "2026-06-05T11:00:00.000Z"
        },
        {
          start: "2026-06-05T10:30:00.000Z",
          end: "2026-06-05T11:30:00.000Z"
        }
      ],
      timeMin: new Date("2026-06-05T09:00:00.000Z"),
      timeMax: new Date("2026-06-05T13:00:00.000Z"),
      durationMinutes: 60,
      maxSlots: 3
    });

    expect(slots).toEqual([
      {
        start_time: "2026-06-05T09:00:00.000Z",
        end_time: "2026-06-05T10:00:00.000Z"
      },
      {
        start_time: "2026-06-05T11:30:00.000Z",
        end_time: "2026-06-05T12:30:00.000Z"
      }
    ]);
  });
});
