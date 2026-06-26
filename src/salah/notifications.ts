import type { PrismaClient, SalahCityChoice, SalahNotificationSetting } from "@prisma/client";
import type { Bot } from "grammy";
import { consoleStructuredLogger, errorContext, type StructuredLogger } from "../logger.js";
import { fetchMuftyatSalahTimes, searchMuftyatCities, type MuftyatCity, type MuftyatDayTimes, type SalahPrayerName } from "./muftyat.js";

const CHECK_INTERVAL_MS = 60_000;
const DELIVERY_WINDOW_MINUTES = 10;
const CITY_CHOICE_TTL_MS = 10 * 60_000;
const START_PRAYERS = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"] as const;
const END_WARNING_PAIRS: Array<{ prayerName: Exclude<SalahPrayerName, "Sunrise" | "Isha">; endAt: SalahPrayerName }> = [
  { prayerName: "Fajr", endAt: "Sunrise" },
  { prayerName: "Dhuhr", endAt: "Asr" },
  { prayerName: "Asr", endAt: "Maghrib" },
  { prayerName: "Maghrib", endAt: "Isha" }
];

export type SalahNotificationKind = "start" | "ending_soon";

export type SalahNotificationDue = {
  localDate: string;
  prayerName: SalahPrayerName;
  kind: SalahNotificationKind;
  scheduledAt: Date;
  message: string;
};

type SalahYearCacheEntry = {
  fetchedAt: Date;
  times: MuftyatDayTimes[];
};

const salahYearCache = new Map<string, Promise<SalahYearCacheEntry>>();

export function cityTimezoneOffset(city: MuftyatCity): number {
  const offset = Number(city.timezone);
  if (!Number.isFinite(offset)) throw new Error(`Invalid city timezone: ${city.timezone}`);
  return offset;
}

export function formatCityLabel(city: Pick<MuftyatCity, "title" | "region" | "district">) {
  return [city.title, city.region, city.district].filter(Boolean).join(", ");
}

export function localDateKeyForOffset(date: Date, timezoneOffset: number): string {
  const shifted = new Date(date.getTime() + timezoneOffset * 60 * 60_000);
  return [
    String(shifted.getUTCFullYear()).padStart(4, "0"),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function parseApiDate(date: string) {
  const match = date.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) throw new Error(`Invalid Muftyat date: ${date}`);
  return {
    day: Number(match[1]),
    month: Number(match[2]),
    year: Number(match[3])
  };
}

export function apiDateToLocalDateKey(date: string): string {
  const parts = parseApiDate(date);
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0")
  ].join("-");
}

export function localTimeToUtc(apiDate: string, time: string, timezoneOffset: number): Date {
  const date = parseApiDate(apiDate);
  const match = time.trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid salah time: ${time}`);
  const localUtcMs = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    Number(match[1]),
    Number(match[2]),
    0
  );
  return new Date(localUtcMs - timezoneOffset * 60 * 60_000);
}

function isDue(scheduledAt: Date, now: Date) {
  const diffMs = now.getTime() - scheduledAt.getTime();
  return diffMs >= 0 && diffMs < DELIVERY_WINDOW_MINUTES * 60_000;
}

export function buildSalahNotificationsForDay(
  day: MuftyatDayTimes,
  timezoneOffset: number
): SalahNotificationDue[] {
  const localDate = apiDateToLocalDateKey(day.date);
  const notifications: SalahNotificationDue[] = [];

  for (const prayerName of START_PRAYERS) {
    notifications.push({
      localDate,
      prayerName,
      kind: "start",
      scheduledAt: localTimeToUtc(day.date, day[prayerName], timezoneOffset),
      message: `${prayerName} time has entered.`
    });
  }

  for (const pair of END_WARNING_PAIRS) {
    const endAt = localTimeToUtc(day.date, day[pair.endAt], timezoneOffset);
    notifications.push({
      localDate,
      prayerName: pair.prayerName,
      kind: "ending_soon",
      scheduledAt: new Date(endAt.getTime() - 30 * 60_000),
      message: `30 minutes left before ${pair.prayerName} time ends.`
    });
  }

  return notifications;
}

export function getDueSalahNotifications(input: {
  times: MuftyatDayTimes[];
  timezoneOffset: number;
  now: Date;
}): SalahNotificationDue[] {
  const today = localDateKeyForOffset(input.now, input.timezoneOffset);
  const day = input.times.find((entry) => apiDateToLocalDateKey(entry.date) === today);
  if (!day) return [];
  return buildSalahNotificationsForDay(day, input.timezoneOffset).filter((notification) =>
    isDue(notification.scheduledAt, input.now)
  );
}

export async function configureSalahNotifications(
  db: PrismaClient,
  userId: string,
  city: MuftyatCity,
  telegramChatId?: string
) {
  const timezoneOffset = cityTimezoneOffset(city);
  const setting = await db.salahNotificationSetting.upsert({
    where: { userId },
    create: {
      userId,
      enabled: true,
      cityId: city.id,
      cityTitle: city.title,
      region: city.region,
      district: city.district,
      latitude: city.lat,
      longitude: city.lng,
      timezoneOffset
    },
    update: {
      enabled: true,
      cityId: city.id,
      cityTitle: city.title,
      region: city.region,
      district: city.district,
      latitude: city.lat,
      longitude: city.lng,
      timezoneOffset
    }
  });

  if (telegramChatId) {
    await db.user.update({
      where: { id: userId },
      data: { telegramChatId }
    });
  }

  return setting;
}

export async function disableSalahNotifications(db: PrismaClient, userId: string) {
  const setting = await db.salahNotificationSetting.findUnique({ where: { userId } });
  if (!setting) return { disabled: false };
  await db.salahNotificationSetting.update({
    where: { userId },
    data: { enabled: false }
  });
  return { disabled: true };
}

export function formatSalahStatus(setting: SalahNotificationSetting | null): string {
  if (!setting) return "Salah notifications are not configured.";
  if (!setting.enabled) {
    return `Salah notifications are off. Last city: ${setting.cityTitle}.`;
  }
  return `Salah notifications are on for ${[setting.cityTitle, setting.region, setting.district]
    .filter(Boolean)
    .join(", ")}.`;
}

export function formatCityChoiceText(cities: MuftyatCity[]): string {
  return [
    "I found multiple matching cities. Please choose one:",
    ...cities.map((city, index) => `${index + 1}. ${formatCityLabel(city)}`)
  ].join("\n");
}

export async function createSalahCityChoices(
  db: PrismaClient,
  userId: string,
  cities: MuftyatCity[]
): Promise<SalahCityChoice[]> {
  const expiresAt = new Date(Date.now() + CITY_CHOICE_TTL_MS);
  await db.salahCityChoice.deleteMany({ where: { userId } });
  return Promise.all(
    cities.slice(0, 10).map((city) =>
      db.salahCityChoice.create({
        data: {
          userId,
          cityId: city.id,
          cityTitle: city.title,
          region: city.region,
          district: city.district,
          latitude: city.lat,
          longitude: city.lng,
          timezoneOffset: cityTimezoneOffset(city),
          expiresAt
        }
      })
    )
  );
}

export function choiceToCity(choice: SalahCityChoice): MuftyatCity {
  return {
    id: choice.cityId,
    title: choice.cityTitle,
    lat: choice.latitude,
    lng: choice.longitude,
    timezone: String(choice.timezoneOffset),
    region: choice.region,
    district: choice.district,
    distance: null
  };
}

export async function resolveSalahCitySearch(db: PrismaClient, userId: string, cityName: string) {
  const cities = await searchMuftyatCities(cityName);
  if (cities.length === 0) {
    return { status: "not_found" as const, cities: [] };
  }
  if (cities.length === 1) {
    const setting = await configureSalahNotifications(db, userId, cities[0]!);
    return { status: "configured" as const, cities, setting };
  }
  const choices = await createSalahCityChoices(db, userId, cities);
  return { status: "multiple" as const, cities, choices };
}

async function getCachedSalahTimes(setting: SalahNotificationSetting, now: Date) {
  const year = Number(localDateKeyForOffset(now, setting.timezoneOffset).slice(0, 4));
  const key = `${year}:${setting.latitude}:${setting.longitude}`;
  const cached = salahYearCache.get(key);
  if (cached) return (await cached).times;

  const promise = fetchMuftyatSalahTimes({
    year,
    latitude: setting.latitude,
    longitude: setting.longitude
  })
    .then((times) => ({ fetchedAt: new Date(), times: times.result }))
    .catch((error) => {
      salahYearCache.delete(key);
      throw error;
    });
  salahYearCache.set(key, promise);
  return (await promise).times;
}

async function markAndSendNotification(
  db: PrismaClient,
  bot: Bot,
  setting: SalahNotificationSetting & { user: { telegramChatId: string | null } },
  notification: SalahNotificationDue,
  now: Date,
  logger: StructuredLogger
) {
  try {
    await db.salahNotificationDelivery.create({
      data: {
        settingId: setting.id,
        localDate: notification.localDate,
        prayerName: notification.prayerName,
        kind: notification.kind,
        sentAt: now
      }
    });
  } catch {
    logger.debug?.(
      {
        scheduler: "salah_notifications",
        settingId: setting.id,
        userId: setting.userId,
        prayerName: notification.prayerName,
        kind: notification.kind
      },
      "salah notification already delivered"
    );
    return;
  }

  if (!setting.user.telegramChatId) return;
  await bot.api.sendMessage(setting.user.telegramChatId, notification.message);
  logger.info(
    {
      scheduler: "salah_notifications",
      settingId: setting.id,
      userId: setting.userId,
      telegramChatId: setting.user.telegramChatId,
      prayerName: notification.prayerName,
      kind: notification.kind
    },
    "salah notification delivered"
  );
}

export function startSalahNotificationScheduler(
  db: PrismaClient,
  bot: Bot,
  logger: StructuredLogger = consoleStructuredLogger
) {
  const tick = async () => {
    try {
      const now = new Date();
      const settings = await db.salahNotificationSetting.findMany({
        where: {
          enabled: true,
          user: { telegramChatId: { not: null } }
        },
        include: { user: { select: { telegramChatId: true } } }
      });

      for (const setting of settings) {
        const times = await getCachedSalahTimes(setting, now);
        const due = getDueSalahNotifications({
          times,
          timezoneOffset: setting.timezoneOffset,
          now
        });

        for (const notification of due) {
          await markAndSendNotification(db, bot, setting, notification, now, logger);
        }
      }
    } catch (error) {
      logger.error(
        {
          scheduler: "salah_notifications",
          ...errorContext(error)
        },
        "salah notification scheduler failed"
      );
    }
  };

  const timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  void tick();
  return timer;
}
