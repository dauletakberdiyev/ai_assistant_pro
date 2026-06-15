import { describe, expect, it, vi } from "vitest";
import { fetchMuftyatSalahTimes, searchMuftyatCities } from "../salah/muftyat.js";
import {
  buildSalahNotificationsForDay,
  configureSalahNotifications,
  disableSalahNotifications,
  getDueSalahNotifications,
  localTimeToUtc
} from "../salah/notifications.js";

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

describe("salah Muftyat API parsing", () => {
  it("parses city search results", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        count: 1,
        results: [
          {
            id: 3,
            title: "Астана қаласы",
            lng: "71.433333",
            lat: "51.133333",
            timezone: "5",
            region: "Республикалық маңызы бар қалалар",
            district: null,
            distance: null
          }
        ]
      })
    ) as any;

    const cities = await searchMuftyatCities("Астана", fetchImpl);

    expect(fetchImpl.mock.calls[0][0]).toContain("search=%D0%90%D1%81%D1%82%D0%B0%D0%BD%D0%B0");
    expect(cities[0]).toMatchObject({
      id: 3,
      title: "Астана қаласы",
      lat: "51.133333",
      lng: "71.433333",
      timezone: "5"
    });
  });

  it("trims prayer time strings", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        result: [
          {
            date: "01-01-2026",
            Fajr: "06:36 ",
            Sunrise: "08:13 ",
            Dhuhr: "12:23 ",
            Asr: "14:36 ",
            Maghrib: "16:23 ",
            Isha: "18:00 "
          }
        ],
        latitude: 51.133333,
        longitude: 71.433333,
        year: 2026,
        city_name: "Астана қаласы",
        timezone: "5"
      })
    ) as any;

    const times = await fetchMuftyatSalahTimes(
      { year: 2026, latitude: "51.133333", longitude: "71.433333" },
      fetchImpl
    );

    expect(times.result[0]?.Fajr).toBe("06:36");
    expect(times.timezone).toBe("5");
  });
});

describe("salah notification scheduling", () => {
  const day = {
    date: "01-01-2026",
    Fajr: "06:36",
    Sunrise: "08:13",
    Dhuhr: "12:23",
    Asr: "14:36",
    Maghrib: "16:23",
    Isha: "18:00"
  };

  it("converts fixed-offset local salah times to UTC", () => {
    expect(localTimeToUtc("01-01-2026", "12:23", 5).toISOString()).toBe(
      "2026-01-01T07:23:00.000Z"
    );
  });

  it("builds start and ending-soon notifications for the day", () => {
    const notifications = buildSalahNotificationsForDay(day, 5);

    expect(notifications).toHaveLength(9);
    expect(notifications).toContainEqual({
      localDate: "2026-01-01",
      prayerName: "Dhuhr",
      kind: "start",
      scheduledAt: new Date("2026-01-01T07:23:00.000Z"),
      message: "Dhuhr time has entered."
    });
    expect(notifications).toContainEqual({
      localDate: "2026-01-01",
      prayerName: "Fajr",
      kind: "ending_soon",
      scheduledAt: new Date("2026-01-01T02:43:00.000Z"),
      message: "30 minutes left before Fajr time ends."
    });
  });

  it("returns notifications due inside the delivery window", () => {
    const due = getDueSalahNotifications({
      times: [day],
      timezoneOffset: 5,
      now: new Date("2026-01-01T09:06:00.000Z")
    });

    expect(due).toEqual([
      expect.objectContaining({
        prayerName: "Dhuhr",
        kind: "ending_soon"
      })
    ]);
  });
});

describe("salah settings", () => {
  it("saves a selected city for the user", async () => {
    const upsert = vi.fn(async ({ create, update }) => ({
      id: "setting_1",
      ...create,
      ...update,
      createdAt: new Date("2026-06-15T00:00:00.000Z"),
      updatedAt: new Date("2026-06-15T00:00:00.000Z")
    }));
    const userUpdate = vi.fn();
    const db = {
      salahNotificationSetting: { upsert },
      user: { update: userUpdate }
    } as any;

    const setting = await configureSalahNotifications(
      db,
      "user_1",
      {
        id: 3,
        title: "Астана қаласы",
        lat: "51.133333",
        lng: "71.433333",
        timezone: "5",
        region: "Республикалық маңызы бар қалалар",
        district: null,
        distance: null
      },
      "chat_1"
    );

    expect(setting.cityTitle).toBe("Астана қаласы");
    expect(setting.timezoneOffset).toBe(5);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { telegramChatId: "chat_1" }
    });
  });

  it("disables existing salah notifications", async () => {
    const update = vi.fn();
    const db = {
      salahNotificationSetting: {
        findUnique: vi.fn(async () => ({ id: "setting_1" })),
        update
      }
    } as any;

    await expect(disableSalahNotifications(db, "user_1")).resolves.toEqual({ disabled: true });
    expect(update).toHaveBeenCalledWith({
      where: { userId: "user_1" },
      data: { enabled: false }
    });
  });
});
