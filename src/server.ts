import cors from "@fastify/cors";
import Fastify from "fastify";
import type { Bot } from "grammy";
import type { PrismaClient } from "@prisma/client";
import type { Env } from "./config/env.js";
import { createGoogleAuthUrl, storeGoogleTokens } from "./google/oauth.js";

export function createServer(db: PrismaClient, env: Env, bot: Bot) {
  const app = Fastify({ logger: true });

  app.register(cors, {
    origin: false
  });

  app.get("/health", async (request, reply) => {
    try {
      await db.$queryRaw`SELECT 1`;
      return { ok: true, database: "ok" };
    } catch (error) {
      request.log.error(
        { error: error instanceof Error ? error.message : String(error) },
        "health check database ping failed"
      );
      return reply.code(503).send({ ok: false, database: "error" });
    }
  });

  app.get("/auth/google/start", async (_request, reply) => {
    const url = await createGoogleAuthUrl(db, env);
    return reply.redirect(url);
  });

  app.get<{
    Querystring: { code?: string; state?: string; error?: string };
  }>("/auth/google/callback", async (request, reply) => {
    if (request.query.error) {
      return reply.code(400).type("text/plain").send(`Google OAuth error: ${request.query.error}`);
    }

    if (!request.query.code || !request.query.state) {
      return reply.code(400).type("text/plain").send("Missing OAuth code or state");
    }

    await storeGoogleTokens(db, env, request.query.state, request.query.code);
    return reply
      .type("text/html")
      .send("<h1>Google Calendar connected</h1><p>You can close this tab.</p>");
  });

  app.post("/telegram/webhook", async (request, reply) => {
    const secret = request.headers["x-telegram-bot-api-secret-token"];
    if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
      return reply.code(401).send({ ok: false, error: "invalid webhook secret" });
    }

    await bot.handleUpdate(request.body as any);
    return reply.send({ ok: true });
  });

  return app;
}
