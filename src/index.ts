import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { createBot } from "./telegram/bot.js";
import { createServer } from "./server.js";
import { startDailyAgendaScheduler } from "./calendar/checkins.js";
import { startSalahNotificationScheduler } from "./salah/notifications.js";

const bot = createBot(prisma, env);
const server = createServer(prisma, env, bot);
let dailyAgendaTimer: NodeJS.Timeout | undefined;
let salahNotificationTimer: NodeJS.Timeout | undefined;

async function shutdown(signal: string) {
  server.log.info({ signal }, "shutting down");
  if (dailyAgendaTimer) clearInterval(dailyAgendaTimer);
  if (salahNotificationTimer) clearInterval(salahNotificationTimer);
  await server.close();
  await prisma.$disconnect();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await bot.init();
dailyAgendaTimer = startDailyAgendaScheduler(prisma, env, bot, server.log);
salahNotificationTimer = startSalahNotificationScheduler(prisma, bot, server.log);
await server.listen({ port: env.PORT, host: "0.0.0.0" });
