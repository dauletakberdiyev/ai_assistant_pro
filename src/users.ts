import type { PrismaClient, User } from "@prisma/client";

export async function getOrCreateAllowedUser(
  db: PrismaClient,
  telegramUserId: string,
  timezone: string,
  telegramChatId?: string
): Promise<User> {
  return db.user.upsert({
    where: { telegramUserId },
    create: { telegramUserId, timezone, telegramChatId },
    update: { timezone, ...(telegramChatId ? { telegramChatId } : {}) }
  });
}
