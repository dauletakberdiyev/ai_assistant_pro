import { Bot, InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import type { PrismaClient, SalahCityChoice } from "@prisma/client";
import type { Env } from "../config/env.js";
import { consoleStructuredLogger, type StructuredLogger } from "../logger.js";
import { buildDailyAgenda } from "../calendar/agenda.js";
import {
  cancelCalendarCancellationDraft,
  confirmCalendarCancellationDraft,
  formatCancellationForTelegram
} from "../calendar/cancellations.js";
import {
  cancelCalendarEventDraft,
  confirmCalendarEventDraft,
  formatDraftForTelegram
} from "../calendar/drafts.js";
import {
  cancelCalendarUpdateDraft,
  confirmCalendarUpdateDraft,
  formatUpdateForTelegram
} from "../calendar/updates.js";
import {
  deleteAllUserPreferences,
  deleteUserPreference,
  formatPreferencesForTelegram,
  listUserPreferences,
  PREFERENCE_KEYS,
  PREFERENCE_LABELS,
  type PreferenceKey
} from "../memory/preferences.js";
import { searchMuftyatCities } from "../salah/muftyat.js";
import {
  choiceToCity,
  configureSalahNotifications,
  createSalahCityChoices,
  disableSalahNotifications,
  formatCityChoiceText,
  formatSalahStatus
} from "../salah/notifications.js";
import { runAssistant } from "../assistant/assistant.js";
import { assertAllowedTelegramUser } from "./auth.js";
import { getOrCreateAllowedUser } from "../users.js";

function authFromContext(ctx: Context, env: Env): string {
  return assertAllowedTelegramUser(ctx.from?.id, env.TELEGRAM_ALLOWED_USER_ID);
}

function draftKeyboard(draftId: string) {
  return new InlineKeyboard()
    .text("Confirm", `draft:confirm:${draftId}`)
    .text("Cancel", `draft:cancel:${draftId}`);
}

function cancellationKeyboard(draftId: string) {
  return new InlineKeyboard()
    .text("Confirm delete", `del:confirm:${draftId}`)
    .text("Keep event", `del:cancel:${draftId}`);
}

function updateKeyboard(draftId: string) {
  return new InlineKeyboard()
    .text("Confirm update", `upd:confirm:${draftId}`)
    .text("Cancel", `upd:cancel:${draftId}`);
}

function salahCityKeyboard(choices: SalahCityChoice[]) {
  const keyboard = new InlineKeyboard();
  choices.forEach((choice, index) => {
    keyboard.text(String(index + 1), `salah:city:${choice.id}`).row();
  });
  return keyboard;
}

async function replyToBotError(ctx: Context, env: Env, error: unknown) {
  const message = error instanceof Error ? error.message : "Assistant error";
  if (message.includes("not allowed")) {
    await ctx.reply("Sorry, this private assistant is not available for this Telegram account.");
    return;
  }

  if (message.includes("Google Calendar is not connected")) {
    await ctx.reply(
      `Google Calendar is not connected yet. Open:\n${env.PUBLIC_BASE_URL}/auth/google/start`
    );
    return;
  }

  await ctx.reply(`I hit an error: ${message}`);
}

function parseAgendaHour(text: string | undefined): number | undefined {
  const rawHour = text?.trim().split(/\s+/)[1];
  if (!rawHour) return undefined;
  const hour = Number(rawHour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error("Use /agenda_on with an hour from 0 to 23, for example /agenda_on 8.");
  }
  return hour;
}

function preferenceHelpText() {
  const keys = PREFERENCE_KEYS.map((key) => `- ${key}: ${PREFERENCE_LABELS[key]}`).join("\n");
  return [`Use /forget <key> or /forget all.`, "Available keys:", keys].join("\n");
}

function parseForgetTarget(text: string | undefined): PreferenceKey | "all" {
  const rawTarget = text?.trim().split(/\s+/)[1];
  if (!rawTarget) throw new Error(preferenceHelpText());
  if (rawTarget === "all") return "all";
  if (PREFERENCE_KEYS.includes(rawTarget as PreferenceKey)) return rawTarget as PreferenceKey;
  throw new Error(preferenceHelpText());
}

function parseSalahCityName(text: string | undefined): string {
  const cityName = text?.trim().split(/\s+/).slice(1).join(" ").trim();
  if (!cityName) {
    throw new Error("Use /salah_on with a Kazakh/Cyrillic city name, for example /salah_on Астана.");
  }
  return cityName;
}

export function createBot(
  db: PrismaClient,
  env: Env,
  logger: StructuredLogger = consoleStructuredLogger
) {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  bot.command("start", async (ctx) => {
    try {
      const telegramUserId = authFromContext(ctx, env);
      await getOrCreateAllowedUser(db, telegramUserId, env.DEFAULT_TIMEZONE, String(ctx.chat.id));
      await ctx.reply(
        [
          "Assistant is online.",
          "Connect Google Calendar here:",
          `${env.PUBLIC_BASE_URL}/auth/google/start`
        ].join("\n")
      );
    } catch {
      await ctx.reply("Sorry, this private assistant is not available for this Telegram account.");
    }
  });

  bot.command("connect_google", async (ctx) => {
    try {
      const telegramUserId = authFromContext(ctx, env);
      await getOrCreateAllowedUser(db, telegramUserId, env.DEFAULT_TIMEZONE, String(ctx.chat.id));
      await ctx.reply(`Connect Google Calendar here:\n${env.PUBLIC_BASE_URL}/auth/google/start`);
    } catch {
      await ctx.reply("Sorry, this private assistant is not available for this Telegram account.");
    }
  });

  const agendaCommand = async (ctx: Context) => {
    try {
      const telegramUserId = authFromContext(ctx, env);
      const user = await getOrCreateAllowedUser(
        db,
        telegramUserId,
        env.DEFAULT_TIMEZONE,
        ctx.chat ? String(ctx.chat.id) : undefined
      );
      const agenda = await buildDailyAgenda(db, env, user.id);
      await ctx.reply(agenda.text);
    } catch (error) {
      await replyToBotError(ctx, env, error);
    }
  };

  bot.command("today", agendaCommand);
  bot.command("agenda", agendaCommand);

  bot.command("agenda_on", async (ctx) => {
    try {
      const telegramUserId = authFromContext(ctx, env);
      const hour = parseAgendaHour(ctx.message?.text);
      const user = await getOrCreateAllowedUser(
        db,
        telegramUserId,
        env.DEFAULT_TIMEZONE,
        String(ctx.chat.id)
      );
      const updatedUser = await db.user.update({
        where: { id: user.id },
        data: {
          dailyAgendaEnabled: true,
          dailyAgendaHour: hour ?? user.dailyAgendaHour,
          telegramChatId: String(ctx.chat.id)
        }
      });
      await ctx.reply(
        `Daily agenda check-ins are on at ${String(updatedUser.dailyAgendaHour).padStart(
          2,
          "0"
        )}:00 ${updatedUser.timezone}.`
      );
    } catch (error) {
      await replyToBotError(ctx, env, error);
    }
  });

  bot.command("agenda_off", async (ctx) => {
    try {
      const telegramUserId = authFromContext(ctx, env);
      const user = await getOrCreateAllowedUser(
        db,
        telegramUserId,
        env.DEFAULT_TIMEZONE,
        String(ctx.chat.id)
      );
      await db.user.update({
        where: { id: user.id },
        data: { dailyAgendaEnabled: false, telegramChatId: String(ctx.chat.id) }
      });
      await ctx.reply("Daily agenda check-ins are off.");
    } catch (error) {
      await replyToBotError(ctx, env, error);
    }
  });

  bot.command("memory", async (ctx) => {
    try {
      const telegramUserId = authFromContext(ctx, env);
      const user = await getOrCreateAllowedUser(
        db,
        telegramUserId,
        env.DEFAULT_TIMEZONE,
        ctx.chat ? String(ctx.chat.id) : undefined
      );
      const preferences = await listUserPreferences(db, user.id);
      await ctx.reply(formatPreferencesForTelegram(preferences));
    } catch (error) {
      await replyToBotError(ctx, env, error);
    }
  });

  bot.command("forget", async (ctx) => {
    try {
      const telegramUserId = authFromContext(ctx, env);
      const user = await getOrCreateAllowedUser(
        db,
        telegramUserId,
        env.DEFAULT_TIMEZONE,
        ctx.chat ? String(ctx.chat.id) : undefined
      );
      const target = parseForgetTarget(ctx.message?.text);

      if (target === "all") {
        const result = await deleteAllUserPreferences(db, user.id);
        await ctx.reply(`Forgot ${result.count} saved preference${result.count === 1 ? "" : "s"}.`);
        return;
      }

      const result = await deleteUserPreference(db, user.id, target);
      await ctx.reply(
        result.deleted
          ? `Forgot ${target}.`
          : `I did not have a saved preference for ${target}.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith("Use /forget")) {
        await ctx.reply(message);
        return;
      }
      await replyToBotError(ctx, env, error);
    }
  });

  bot.command("salah_on", async (ctx) => {
    try {
      const telegramUserId = authFromContext(ctx, env);
      const user = await getOrCreateAllowedUser(
        db,
        telegramUserId,
        env.DEFAULT_TIMEZONE,
        String(ctx.chat.id)
      );
      const cityName = parseSalahCityName(ctx.message?.text);
      const cities = await searchMuftyatCities(cityName);

      if (cities.length === 0) {
        await ctx.reply("City was not found. Please type the city name correctly in Kazakh/Cyrillic.");
        return;
      }

      if (cities.length === 1) {
        const setting = await configureSalahNotifications(
          db,
          user.id,
          cities[0]!,
          String(ctx.chat.id)
        );
        await ctx.reply(formatSalahStatus(setting));
        return;
      }

      const choices = await createSalahCityChoices(db, user.id, cities);
      await ctx.reply(formatCityChoiceText(cities.slice(0, choices.length)), {
        reply_markup: salahCityKeyboard(choices)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith("Use /salah_on")) {
        await ctx.reply(message);
        return;
      }
      await replyToBotError(ctx, env, error);
    }
  });

  bot.command("salah_off", async (ctx) => {
    try {
      const telegramUserId = authFromContext(ctx, env);
      const user = await getOrCreateAllowedUser(
        db,
        telegramUserId,
        env.DEFAULT_TIMEZONE,
        ctx.chat ? String(ctx.chat.id) : undefined
      );
      const result = await disableSalahNotifications(db, user.id);
      await ctx.reply(result.disabled ? "Salah notifications are off." : "Salah notifications were not configured.");
    } catch (error) {
      await replyToBotError(ctx, env, error);
    }
  });

  bot.command("salah_status", async (ctx) => {
    try {
      const telegramUserId = authFromContext(ctx, env);
      const user = await getOrCreateAllowedUser(
        db,
        telegramUserId,
        env.DEFAULT_TIMEZONE,
        ctx.chat ? String(ctx.chat.id) : undefined
      );
      const setting = await db.salahNotificationSetting.findUnique({
        where: { userId: user.id }
      });
      await ctx.reply(formatSalahStatus(setting));
    } catch (error) {
      await replyToBotError(ctx, env, error);
    }
  });

  bot.on("callback_query:data", async (ctx) => {
    try {
      const telegramUserId = authFromContext(ctx, env);
      const user = await getOrCreateAllowedUser(
        db,
        telegramUserId,
        env.DEFAULT_TIMEZONE,
        ctx.chat ? String(ctx.chat.id) : undefined
      );
      const [kind, action, draftId] = ctx.callbackQuery.data.split(":");

      if (kind === "salah") {
        if (action !== "city" || !draftId) {
          await ctx.answerCallbackQuery({ text: "Unknown salah action" });
          return;
        }

        const choice = await db.salahCityChoice.findFirst({
          where: {
            id: draftId,
            userId: user.id,
            expiresAt: { gt: new Date() }
          }
        });
        if (!choice) {
          await ctx.answerCallbackQuery({ text: "City choice expired", show_alert: true });
          return;
        }

        const setting = await configureSalahNotifications(
          db,
          user.id,
          choiceToCity(choice),
          ctx.chat ? String(ctx.chat.id) : undefined
        );
        await db.salahCityChoice.deleteMany({ where: { userId: user.id } });
        await ctx.answerCallbackQuery({ text: "Salah notifications enabled" });
        await ctx.editMessageText(formatSalahStatus(setting));
        return;
      }

      if (
        !["draft", "del", "upd"].includes(kind ?? "") ||
        !draftId ||
        !["confirm", "cancel"].includes(action ?? "")
      ) {
        await ctx.answerCallbackQuery({ text: "Unknown action" });
        return;
      }

      if (kind === "draft") {
        if (action === "confirm") {
          const result = await confirmCalendarEventDraft(db, env, user.id, draftId, logger);
          const { event } = result;
          if (result.alreadyProcessing) {
            await ctx.answerCallbackQuery({ text: "Calendar event is already being created" });
            return;
          }
          await ctx.answerCallbackQuery({
            text: result.alreadyProcessed ? "Calendar event was already created" : "Calendar event created"
          });
          await ctx.editMessageText(
            `${result.alreadyProcessed ? "Already created" : "Created"}: ${
              event.summary ?? "calendar event"
            }\nEvent ID: ${event.id ?? "unknown"}`
          );
          return;
        }

        await cancelCalendarEventDraft(db, user.id, draftId);
        await ctx.answerCallbackQuery({ text: "Draft canceled" });
        await ctx.editMessageText("Canceled calendar event draft.");
        return;
      }

      if (kind === "upd") {
        if (action === "confirm") {
          const result = await confirmCalendarUpdateDraft(db, env, user.id, draftId, logger);
          const { event } = result;
          if (result.alreadyProcessing) {
            await ctx.answerCallbackQuery({ text: "Calendar event is already being updated" });
            return;
          }
          await ctx.answerCallbackQuery({
            text: result.alreadyProcessed ? "Calendar event was already updated" : "Calendar event updated"
          });
          await ctx.editMessageText(
            `${result.alreadyProcessed ? "Already updated" : "Updated"}: ${
              event.summary ?? "calendar event"
            }\nEvent ID: ${event.id ?? "unknown"}`
          );
          return;
        }

        await cancelCalendarUpdateDraft(db, user.id, draftId);
        await ctx.answerCallbackQuery({ text: "Update canceled" });
        await ctx.editMessageText("Canceled calendar update draft.");
        return;
      }

      if (action === "confirm") {
        const result = await confirmCalendarCancellationDraft(db, env, user.id, draftId, logger);
        if (result.alreadyProcessing) {
          await ctx.answerCallbackQuery({ text: "Calendar event is already being deleted" });
          return;
        }
        await ctx.answerCallbackQuery({
          text: result.alreadyProcessed ? "Calendar event was already deleted" : "Calendar event deleted"
        });
        await ctx.editMessageText(
          result.alreadyProcessed ? "Already deleted calendar event." : "Deleted calendar event."
        );
        return;
      }

      await cancelCalendarCancellationDraft(db, user.id, draftId);
      await ctx.answerCallbackQuery({ text: "Event kept" });
      await ctx.editMessageText("Kept calendar event.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not process action";
      await ctx.answerCallbackQuery({ text: message, show_alert: true });
    }
  });

  bot.on("message:text", async (ctx) => {
    try {
      const telegramUserId = authFromContext(ctx, env);
      const user = await getOrCreateAllowedUser(
        db,
        telegramUserId,
        env.DEFAULT_TIMEZONE,
        String(ctx.chat.id)
      );
      const chatId = String(ctx.chat.id);
      const text = ctx.message.text;

      await db.message.create({
        data: {
          userId: user.id,
          telegramChatId: chatId,
          role: "user",
          content: text,
          raw: ctx.message as object
        }
      });

      const result = await runAssistant(db, env, user.id, text, logger);

      await db.message.create({
        data: {
          userId: user.id,
          telegramChatId: chatId,
          role: "assistant",
          content: result.text
        }
      });

      await ctx.reply(result.text);

      for (const draft of result.pendingDrafts) {
        await ctx.reply(formatDraftForTelegram(draft), {
          reply_markup: draftKeyboard(draft.id)
        });
      }

      for (const draft of result.pendingCancellationDrafts) {
        await ctx.reply(formatCancellationForTelegram(draft), {
          reply_markup: cancellationKeyboard(draft.id)
        });
      }

      for (const draft of result.pendingUpdateDrafts) {
        await ctx.reply(formatUpdateForTelegram(draft), {
          reply_markup: updateKeyboard(draft.id)
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Assistant error";
      if (message.includes("not allowed")) {
        await ctx.reply("Sorry, this private assistant is not available for this Telegram account.");
        return;
      }

      if (message.includes("Google Calendar is not connected")) {
        await ctx.reply(
          `Google Calendar is not connected yet. Open:\n${env.PUBLIC_BASE_URL}/auth/google/start`
        );
        return;
      }

      await ctx.reply(`I hit an error: ${message}`);
    }
  });

  return bot;
}
