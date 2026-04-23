-- CreateTable
CREATE TABLE `dbu_users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `role` ENUM('CLIENT', 'BARBER', 'ADMIN') NOT NULL DEFAULT 'CLIENT',
    `rank` ENUM('MEMBER', 'PRO', 'ELITE', 'COACH', 'DYNASTY') NULL,
    `referralCode` VARCHAR(191) NOT NULL,
    `sponsorId` VARCHAR(191) NULL,
    `stripeCustomerId` VARCHAR(191) NULL,
    `stripeSubscriptionId` VARCHAR(191) NULL,
    `isSubscriptionWaived` BOOLEAN NOT NULL DEFAULT false,
    `hasFirstPayment` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `dbu_users_email_key`(`email`),
    UNIQUE INDEX `dbu_users_referralCode_key`(`referralCode`),
    UNIQUE INDEX `dbu_users_stripeCustomerId_key`(`stripeCustomerId`),
    UNIQUE INDEX `dbu_users_stripeSubscriptionId_key`(`stripeSubscriptionId`),
    INDEX `dbu_users_sponsorId_idx`(`sponsorId`),
    INDEX `dbu_users_role_idx`(`role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dbu_barber_profiles` (
    `userId` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `bio` TEXT NULL,
    `weeklyAvailability` JSON NOT NULL,
    `capacityTargetHrs` INTEGER NOT NULL DEFAULT 40,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `dbu_barber_profiles_slug_key`(`slug`),
    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dbu_services` (
    `id` VARCHAR(191) NOT NULL,
    `barberProfileId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `durationMin` INTEGER NOT NULL,
    `priceCents` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `dbu_services_barberProfileId_idx`(`barberProfileId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dbu_bookings` (
    `id` VARCHAR(191) NOT NULL,
    `barberId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `serviceId` VARCHAR(191) NOT NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NOT NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW') NOT NULL DEFAULT 'PENDING',
    `stripePaymentIntentId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `dbu_bookings_stripePaymentIntentId_key`(`stripePaymentIntentId`),
    INDEX `dbu_bookings_barberId_startAt_idx`(`barberId`, `startAt`),
    INDEX `dbu_bookings_clientId_startAt_idx`(`clientId`, `startAt`),
    INDEX `dbu_bookings_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dbu_payments` (
    `id` VARCHAR(191) NOT NULL,
    `stripePaymentIntentId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `amountCents` INTEGER NOT NULL,
    `productType` ENUM('BOOKING', 'MEMBERSHIP', 'COACHING') NOT NULL,
    `status` ENUM('SUCCEEDED', 'FAILED', 'REFUNDED') NOT NULL DEFAULT 'SUCCEEDED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `dbu_payments_stripePaymentIntentId_key`(`stripePaymentIntentId`),
    INDEX `dbu_payments_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dbu_commissions` (
    `id` VARCHAR(191) NOT NULL,
    `sourcePaymentId` VARCHAR(191) NOT NULL,
    `beneficiaryId` VARCHAR(191) NOT NULL,
    `payerId` VARCHAR(191) NOT NULL,
    `level` INTEGER NOT NULL,
    `rankAtPayout` ENUM('MEMBER', 'PRO', 'ELITE', 'COACH', 'DYNASTY') NOT NULL,
    `amountCents` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'CANCELED') NOT NULL DEFAULT 'PENDING',
    `releaseAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `dbu_commissions_beneficiaryId_status_idx`(`beneficiaryId`, `status`),
    INDEX `dbu_commissions_status_releaseAt_idx`(`status`, `releaseAt`),
    UNIQUE INDEX `dbu_commissions_sourcePaymentId_beneficiaryId_level_key`(`sourcePaymentId`, `beneficiaryId`, `level`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dbu_course_modules` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `loomUrl` VARCHAR(191) NOT NULL,
    `orderIndex` INTEGER NOT NULL,
    `unlockRule` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `dbu_course_modules_orderIndex_idx`(`orderIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dbu_course_progress` (
    `userId` VARCHAR(191) NOT NULL,
    `moduleId` VARCHAR(191) NOT NULL,
    `completedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`, `moduleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dbu_admin_action_logs` (
    `id` VARCHAR(191) NOT NULL,
    `adminId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `payload` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `dbu_admin_action_logs_adminId_createdAt_idx`(`adminId`, `createdAt`),
    INDEX `dbu_admin_action_logs_targetType_targetId_idx`(`targetType`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dbu_webhook_events` (
    `id` VARCHAR(191) NOT NULL,
    `stripeEventId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `processedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `dbu_webhook_events_stripeEventId_key`(`stripeEventId`),
    INDEX `dbu_webhook_events_type_processedAt_idx`(`type`, `processedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `dbu_users` ADD CONSTRAINT `dbu_users_sponsorId_fkey` FOREIGN KEY (`sponsorId`) REFERENCES `dbu_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dbu_barber_profiles` ADD CONSTRAINT `dbu_barber_profiles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `dbu_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dbu_services` ADD CONSTRAINT `dbu_services_barberProfileId_fkey` FOREIGN KEY (`barberProfileId`) REFERENCES `dbu_barber_profiles`(`userId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dbu_bookings` ADD CONSTRAINT `dbu_bookings_barberId_fkey` FOREIGN KEY (`barberId`) REFERENCES `dbu_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dbu_bookings` ADD CONSTRAINT `dbu_bookings_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `dbu_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dbu_bookings` ADD CONSTRAINT `dbu_bookings_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `dbu_services`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dbu_payments` ADD CONSTRAINT `dbu_payments_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `dbu_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dbu_commissions` ADD CONSTRAINT `dbu_commissions_sourcePaymentId_fkey` FOREIGN KEY (`sourcePaymentId`) REFERENCES `dbu_payments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dbu_commissions` ADD CONSTRAINT `dbu_commissions_beneficiaryId_fkey` FOREIGN KEY (`beneficiaryId`) REFERENCES `dbu_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dbu_commissions` ADD CONSTRAINT `dbu_commissions_payerId_fkey` FOREIGN KEY (`payerId`) REFERENCES `dbu_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dbu_course_progress` ADD CONSTRAINT `dbu_course_progress_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `dbu_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dbu_course_progress` ADD CONSTRAINT `dbu_course_progress_moduleId_fkey` FOREIGN KEY (`moduleId`) REFERENCES `dbu_course_modules`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dbu_admin_action_logs` ADD CONSTRAINT `dbu_admin_action_logs_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `dbu_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

