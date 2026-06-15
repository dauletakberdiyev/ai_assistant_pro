# Telegram AI Calendar Assistant

A single-user MVP assistant that talks through Telegram, uses OpenAI tool calling, connects to Google Calendar, and requires Telegram button confirmation before creating, updating, or deleting calendar events.

## What Works in the MVP

- Telegram webhook endpoint with secret-token verification.
- Single allowed Telegram user via `TELEGRAM_ALLOWED_USER_ID`.
- Google OAuth connection for Calendar access.
- Calendar tools for listing events, free/busy lookup, and event drafting.
- Daily agenda summaries through `/today` and `/agenda`.
- Opt-in daily agenda check-ins through `/agenda_on` and `/agenda_off`.
- Transparent saved calendar preferences through `/memory` and `/forget`.
- Event creation only after pressing the Telegram `Confirm` inline button.
- Event update/reschedule only after pressing the Telegram `Confirm update` inline button.
- Event deletion only after pressing the Telegram `Confirm delete` inline button.
- PostgreSQL persistence through Prisma.
- Unit tests for auth, crypto, tool schemas, and draft safety.

Notion, vector memory, recurring sync, and multi-user onboarding are intentionally deferred.

## Requirements

- Node.js `>=18.18`
- npm
- Docker
- A Telegram bot token from BotFather
- A Google Cloud OAuth client with Calendar API enabled
- An HTTPS tunnel such as ngrok or cloudflared

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your env file:

   ```bash
   cp .env.example .env
   ```

3. Generate a token encryption key:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   Put the value in `TOKEN_ENCRYPTION_KEY`.

4. Start Postgres:

   ```bash
   docker compose up -d
   ```

5. Create the database schema:

   ```bash
   npm run db:generate
   npm run db:migrate
   ```

6. Start the app:

   ```bash
   npm run dev
   ```

7. Expose the local server:

   ```bash
   ngrok http 3000
   ```

   Set `PUBLIC_BASE_URL` in `.env` to the HTTPS URL from your tunnel.

8. Register the Telegram webhook:

   ```bash
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d "url=$PUBLIC_BASE_URL/telegram/webhook" \
     -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
   ```

9. Open Telegram and send:

   ```text
   /start
   ```

10. Connect Google Calendar from the URL returned by `/start` or:

    ```text
    /connect_google
    ```

## Google OAuth Notes

In Google Cloud Console:

- Enable the Google Calendar API.
- Create an OAuth 2.0 Web Application client.
- Add this redirect URI:

  ```text
  https://YOUR_PUBLIC_BASE_URL/auth/google/callback
  ```

For local testing with an unverified OAuth app, add your Google account as a test user.

## Useful Commands

```bash
npm run dev
npm run typecheck
npm test
npm run db:studio
```

## Telegram Commands

```text
/start
/connect_google
/today
/agenda
/agenda_on 8
/agenda_off
/memory
/forget working_hours_start
```

`/agenda_on` enables one conservative daily agenda check-in at the selected local hour.
The agenda includes today's events, free work blocks, conflicts, and the next upcoming event.
`/memory` lists saved calendar preferences. `/forget <key>` removes one preference, and `/forget all`
clears saved preferences.

## Safety Model

The assistant can read calendar data, summarize agendas, create event drafts, create update drafts, and create deletion drafts. It cannot directly create, update, or delete Google Calendar events from a model tool call. Actual insertion, patching, or deletion happens only when the allowed Telegram user presses the relevant inline confirmation button.

## Memory Model

The assistant can save a small set of explicit calendar preferences:

- `working_hours_start`
- `working_hours_end`
- `default_meeting_duration_minutes`
- `preferred_calendar_behavior`

Saved preferences are shown with `/memory` and can be deleted with `/forget <key>` or `/forget all`.
The assistant should only save preferences when the user explicitly asks it to remember, save, prefer,
default, usually, or set a stable calendar preference.
