import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { createBot } from "./telegram/bot.js";
import { createServer } from "./server.js";
import { startDailyAgendaScheduler } from "./calendar/checkins.js";
import { startSalahNotificationScheduler } from "./salah/notifications.js";
import { errorContext } from "./logger.js";

const bot = createBot(prisma, env);
const server = createServer(prisma, env, bot);
let dailyAgendaTimer: NodeJS.Timeout | undefined;
let salahNotificationTimer: NodeJS.Timeout | undefined;
let shuttingDown = false;

async function shutdown(signal: string) {
  shuttingDown = true;
  server.log.info({ signal }, "shutting down");
  if (dailyAgendaTimer) clearInterval(dailyAgendaTimer);
  if (salahNotificationTimer) clearInterval(salahNotificationTimer);
  await server.close();
  await prisma.$disconnect();
}

async function startBackgroundWorkers() {
  try {
    await bot.init();
    if (shuttingDown) return;

    dailyAgendaTimer = startDailyAgendaScheduler(prisma, env, bot, server.log);
    salahNotificationTimer = startSalahNotificationScheduler(prisma, bot, server.log);
    server.log.info("background workers started");
  } catch (error) {
    server.log.error(errorContext(error), "background worker startup failed");
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await server.listen({ port: env.PORT, host: "0.0.0.0" });
void startBackgroundWorkers();
