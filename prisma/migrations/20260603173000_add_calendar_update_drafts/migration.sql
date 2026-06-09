-- CreateTable
CREATE TABLE "CalendarEventUpdateDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "currentTitle" TEXT NOT NULL,
    "newTitle" TEXT,
    "newStartTime" TIMESTAMP(3),
    "newEndTime" TIMESTAMP(3),
    "timezone" TEXT NOT NULL,
    "newDescription" TEXT,
    "newLocation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),

    CONSTRAINT "CalendarEventUpdateDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarEventUpdateDraft_userId_status_idx" ON "CalendarEventUpdateDraft"("userId", "status");

-- AddForeignKey
ALTER TABLE "CalendarEventUpdateDraft" ADD CONSTRAINT "CalendarEventUpdateDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
