import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export type PrismaLike = Pick<
  PrismaClient,
  | "user"
  | "message"
  | "assistantRun"
  | "toolCall"
  | "calendarEventDraft"
  | "calendarEventCancellationDraft"
  | "calendarEventUpdateDraft"
  | "oAuthAccount"
>;
