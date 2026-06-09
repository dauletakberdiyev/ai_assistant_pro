import { google } from "googleapis";
import type { Credentials } from "google-auth-library";
import type { PrismaClient } from "@prisma/client";
import type { Env } from "../config/env.js";
import { decryptSecret, encryptSecret } from "../security/crypto.js";
import { signState, verifyState } from "../security/state.js";
import { getOrCreateAllowedUser } from "../users.js";

export const GOOGLE_PROVIDER = "google";

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy"
];

export function createOAuth2Client(env: Env) {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    `${env.PUBLIC_BASE_URL}/auth/google/callback`
  );
}

export async function createGoogleAuthUrl(db: PrismaClient, env: Env): Promise<string> {
  const user = await getOrCreateAllowedUser(
    db,
    env.TELEGRAM_ALLOWED_USER_ID,
    env.DEFAULT_TIMEZONE
  );
  const client = createOAuth2Client(env);
  const state = signState({ userId: user.id }, env.TOKEN_ENCRYPTION_KEY);

  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: CALENDAR_SCOPES,
    state
  });
}

export async function storeGoogleTokens(
  db: PrismaClient,
  env: Env,
  signedState: string,
  code: string
) {
  const { userId } = verifyState<{ userId: string }>(signedState, env.TOKEN_ENCRYPTION_KEY);
  const client = createOAuth2Client(env);
  const { tokens } = await client.getToken(code);

  await upsertGoogleTokens(db, env, userId, tokens);
  return { userId };
}

export async function upsertGoogleTokens(
  db: PrismaClient,
  env: Env,
  userId: string,
  tokens: Credentials
) {
  const existing = await db.oAuthAccount.findUnique({
    where: { userId_provider: { userId, provider: GOOGLE_PROVIDER } }
  });

  await db.oAuthAccount.upsert({
    where: { userId_provider: { userId, provider: GOOGLE_PROVIDER } },
    create: {
      userId,
      provider: GOOGLE_PROVIDER,
      accessToken: tokens.access_token
        ? encryptSecret(tokens.access_token, env.TOKEN_ENCRYPTION_KEY)
        : null,
      refreshToken: tokens.refresh_token
        ? encryptSecret(tokens.refresh_token, env.TOKEN_ENCRYPTION_KEY)
        : null,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scopes: tokens.scope ?? null,
      tokenType: tokens.token_type ?? null
    },
    update: {
      accessToken: tokens.access_token
        ? encryptSecret(tokens.access_token, env.TOKEN_ENCRYPTION_KEY)
        : existing?.accessToken ?? null,
      refreshToken: tokens.refresh_token
        ? encryptSecret(tokens.refresh_token, env.TOKEN_ENCRYPTION_KEY)
        : existing?.refreshToken ?? null,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : existing?.expiryDate ?? null,
      scopes: tokens.scope ?? existing?.scopes ?? null,
      tokenType: tokens.token_type ?? existing?.tokenType ?? null
    }
  });
}

export async function getAuthorizedGoogleClient(
  db: PrismaClient,
  env: Env,
  userId: string
) {
  const account = await db.oAuthAccount.findUnique({
    where: { userId_provider: { userId, provider: GOOGLE_PROVIDER } }
  });

  if (!account?.refreshToken) {
    throw new Error("Google Calendar is not connected. Open /auth/google/start first.");
  }

  const client = createOAuth2Client(env);
  client.setCredentials({
    access_token: account.accessToken
      ? decryptSecret(account.accessToken, env.TOKEN_ENCRYPTION_KEY)
      : undefined,
    refresh_token: decryptSecret(account.refreshToken, env.TOKEN_ENCRYPTION_KEY),
    expiry_date: account.expiryDate?.getTime(),
    token_type: account.tokenType ?? undefined,
    scope: account.scopes ?? undefined
  });

  client.on("tokens", async (tokens) => {
    await upsertGoogleTokens(db, env, userId, tokens);
  });

  return client;
}
