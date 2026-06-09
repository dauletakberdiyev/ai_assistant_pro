export function assertAllowedTelegramUser(
  incomingTelegramUserId: number | string | undefined,
  allowedTelegramUserId: string
): string {
  if (incomingTelegramUserId === undefined) {
    throw new Error("Telegram update is missing a user id");
  }

  const normalized = String(incomingTelegramUserId);
  if (normalized !== allowedTelegramUserId) {
    throw new Error("Telegram user is not allowed");
  }

  return normalized;
}
