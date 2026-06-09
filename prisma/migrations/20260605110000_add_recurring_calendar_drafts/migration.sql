ALTER TABLE "CalendarEventDraft" ADD COLUMN "recurrenceRule" TEXT;

ALTER TABLE "CalendarEventUpdateDraft" ADD COLUMN "newRecurrenceRule" TEXT;
