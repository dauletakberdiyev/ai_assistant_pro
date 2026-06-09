import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { createBot } from "./telegram/bot.js";
import { createServer } from "./server.js";
import { startDailyAgendaScheduler } from "./calendar/checkins.js";

const bot = createBot(prisma, env);
const server = createServer(prisma, env, bot);
let dailyAgendaTimer: NodeJS.Timeout | undefined;

async function shutdown(signal: string) {
  server.log.info({ signal }, "shutting down");
  if (dailyAgendaTimer) clearInterval(dailyAgendaTimer);
  await server.close();
  await prisma.$disconnect();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await bot.init();
dailyAgendaTimer = startDailyAgendaScheduler(prisma, env, bot);
await server.listen({ port: env.PORT, host: "0.0.0.0" });
