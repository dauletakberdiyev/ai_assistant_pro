CREATE TABLE "SalahNotificationSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cityId" INTEGER NOT NULL,
    "cityTitle" TEXT NOT NULL,
    "region" TEXT,
    "district" TEXT,
    "latitude" TEXT NOT NULL,
    "longitude" TEXT NOT NULL,
    "timezoneOffset" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalahNotificationSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalahNotificationDelivery" (
    "id" TEXT NOT NULL,
    "settingId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "prayerName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalahNotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalahCityChoice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cityId" INTEGER NOT NULL,
    "cityTitle" TEXT NOT NULL,
    "region" TEXT,
    "district" TEXT,
    "latitude" TEXT NOT NULL,
    "longitude" TEXT NOT NULL,
    "timezoneOffset" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalahCityChoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalahNotificationSetting_userId_key" ON "SalahNotificationSetting"("userId");

CREATE INDEX "SalahNotificationSetting_enabled_idx" ON "SalahNotificationSetting"("enabled");

CREATE UNIQUE INDEX "SalahNotificationDelivery_settingId_localDate_prayerName_kind_key" ON "SalahNotificationDelivery"("settingId", "localDate", "prayerName", "kind");

CREATE INDEX "SalahNotificationDelivery_settingId_sentAt_idx" ON "SalahNotificationDelivery"("settingId", "sentAt");

CREATE INDEX "SalahCityChoice_userId_expiresAt_idx" ON "SalahCityChoice"("userId", "expiresAt");

ALTER TABLE "SalahNotificationSetting" ADD CONSTRAINT "SalahNotificationSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SalahNotificationDelivery" ADD CONSTRAINT "SalahNotificationDelivery_settingId_fkey" FOREIGN KEY ("settingId") REFERENCES "SalahNotificationSetting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SalahCityChoice" ADD CONSTRAINT "SalahCityChoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
