# AI Assistant Roadmap

This roadmap is based on the current MVP and our planning conversation.

## Current MVP: Calendar Assistant

Status: done

- Telegram bot interface with webhook handling.
- Single-user access control through `TELEGRAM_ALLOWED_USER_ID`.
- Google Calendar OAuth connection.
- Calendar event listing and free/busy lookup.
- Safe event creation through assistant-created drafts and Telegram confirmation buttons.
- Safe event update/reschedule through assistant-created update drafts and Telegram confirmation buttons.
- Safe event deletion through assistant-created cancellation drafts and Telegram confirmation buttons.
- Opt-in salah time notifications through Muftyat city and prayer-time APIs.
- PostgreSQL persistence through Prisma.
- Unit tests for auth, crypto, tool schemas, and calendar draft safety.

## Phase 1: Complete Safe Calendar CRUD

Status: done

Goal: make the assistant able to edit existing calendar events with the same safety model used for create/delete.

- Add event update/reschedule support.
- Let the assistant change event title, start/end time, duration, description, and location.
- Require a pending update draft before mutating Google Calendar.
- Add Telegram `Confirm update` and `Cancel` buttons.
- Use Google Calendar `events.patch` only after user confirmation.
- Add tests proving drafts do not mutate Calendar and confirmation updates only the intended pending draft.

Suggested implementation shape:

- Add a `calendarEventUpdateDraft` Prisma model.
- Add `draft_update_calendar_event` tool schema.
- Add update draft creation and confirmation logic under `src/calendar`.
- Add Google Calendar patch helper under `src/google/calendar.ts`.
- Wire update confirmation callbacks in the Telegram bot.
- Update assistant instructions so the model never claims an event was updated before confirmation.

## Phase 2: Daily Agenda and Proactive Help

Status: done

Goal: make the assistant useful without the user always initiating every interaction.

- Add a daily agenda command, for example `/today` or `/agenda`. Done.
- Summarize upcoming meetings, free blocks, and schedule conflicts. Done.
- Add reminder-style nudges before important events. Done as a next-up nudge in the agenda summary.
- Add opt-in scheduled check-ins. Done with `/agenda_on [hour]` and `/agenda_off`.
- Keep proactive behavior conservative and user-controlled. Done.

## Phase 3: Better Calendar Intelligence

Status: done

Goal: move from simple calendar operations to scheduling assistance.

- Suggest available time slots for requested tasks or meetings. Done.
- Detect conflicts before drafting events. Done.
- Ask clarifying questions when requested times are ambiguous. Done.
- Support recurring event creation and editing. Done.
- Improve timezone handling and date interpretation. Done.

## Phase 4: Memory and Personal Context

Status: done

Goal: remember stable user preferences and context safely.

- Add lightweight user preferences, such as working hours, default meeting duration, and preferred calendar behavior. Done.
- Add vector memory only after the assistant has enough useful recurring context. Deferred.
- Keep memory transparent: the user should be able to inspect and delete stored preferences. Done with `/memory` and `/forget`.

## Phase 5: Salah Time Notifier

Status: done

Goal: send opt-in salah reminders based on the user's selected city.

- Search Muftyat cities by user-provided Kazakh/Cyrillic city name. Done.
- Store only the user's selected city, not the full city catalog. Done.
- Send notifications when each salah time enters. Done.
- Send reminders 30 minutes before Fajr, Dhuhr, Asr, and Maghrib windows end. Done.
- Let the user change or disable the selected city. Done with `/salah_on`, `/salah_off`, `/salah_status`, and assistant tools.

## Phase 6: Notion and Knowledge Work

Status: deferred

Goal: connect calendar actions to notes, tasks, and planning workflows.

- Add Notion OAuth or integration-token connection.
- Create notes from meetings or schedule blocks.
- Find relevant notes before meetings.
- Draft follow-up tasks from calendar events.

## Phase 7: Multi-User Productization

Status: deferred

Goal: move from single-user MVP to a product-shaped system.

- Replace single allowed user env config with user onboarding.
- Support multiple Telegram users and separate OAuth accounts.
- Add account management commands.
- Improve observability, error reporting, and deployment workflow.
- Add stricter production security checks.

## Immediate Next Step

Implement Phase 6: Notion and knowledge work.

This is the natural next step because the assistant now supports safe create, update, delete, daily agenda summaries, free-block detection, conflict summaries, opt-in daily check-ins, scheduling intelligence, recurring events, transparent calendar preferences, and salah time notifications.
