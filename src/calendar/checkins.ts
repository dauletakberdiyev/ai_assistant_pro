import type { PrismaClient, User } from "@prisma/client";
import type { Bot } from "grammy";
import type { Env } from "../config/env.js";
import { consoleStructuredLogger, errorContext, type StructuredLogger } from "../logger.js";
import { buildDailyAgenda, localDayKey, localHourMinute } from "./agenda.js";

const CHECK_INTERVAL_MS = 60_000;
const DELIVERY_WINDOW_MINUTES = 10;

export function shouldSendDailyAgenda(user: User, now: Date): boolean {
  if (!user.dailyAgendaEnabled || !user.telegramChatId) return false;

  const localTime = localHourMinute(now, user.timezone);
  if (localTime.hour !== user.dailyAgendaHour || localTime.minute >= DELIVERY_WINDOW_MINUTES) {
    return false;
  }

  if (!user.lastDailyAgendaSentAt) return true;
  return localDayKey(user.lastDailyAgendaSentAt, user.timezone) !== localDayKey(now, user.timezone);
}

export function startDailyAgendaScheduler(
  db: PrismaClient,
  env: Env,
  bot: Bot,
  logger: StructuredLogger = consoleStructuredLogger
) {
  const tick = async () => {
    try {
      const now = new Date();
      const users = await db.user.findMany({
        where: {
          dailyAgendaEnabled: true,
          telegramChatId: { not: null }
        }
      });

      for (const user of users) {
        if (!shouldSendDailyAgenda(user, now)) continue;

        const agenda = await buildDailyAgenda(db, env, user.id, { now });
        await bot.api.sendMessage(user.telegramChatId!, agenda.text);
        logger.info(
          {
            scheduler: "daily_agenda",
            userId: user.id,
            telegramChatId: user.telegramChatId
          },
          "daily agenda delivered"
        );
        await db.user.update({
          where: { id: user.id },
          data: { lastDailyAgendaSentAt: now }
        });
      }
    } catch (error) {
      logger.error(
        {
          scheduler: "daily_agenda",
          ...errorContext(error)
        },
        "daily agenda check-in failed"
      );
    }
  };

  const timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  void tick();
  return timer;
}
