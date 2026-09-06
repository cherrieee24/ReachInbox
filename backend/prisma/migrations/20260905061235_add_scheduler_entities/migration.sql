-- CreateEnum
CREATE TYPE "EmailJobStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PROCESSING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('PENDING', 'SCHEDULED', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SenderProvider" AS ENUM ('SMTP', 'ETHEREAL', 'GMAIL');

-- CreateEnum
CREATE TYPE "SlackConnectionStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "senders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "from_email" TEXT NOT NULL,
    "provider" "SenderProvider" NOT NULL DEFAULT 'SMTP',
    "host" TEXT,
    "port" INTEGER,
    "secure" BOOLEAN NOT NULL DEFAULT false,
    "username" TEXT,
    "password_encrypted" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "senders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "delay_between_emails" INTEGER NOT NULL DEFAULT 30,
    "hourly_limit" INTEGER NOT NULL DEFAULT 100,
    "status" "EmailJobStatus" NOT NULL DEFAULT 'DRAFT',
    "total_recipients" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_recipients" (
    "id" TEXT NOT NULL,
    "email_job_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "status" "RecipientStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "team_name" TEXT NOT NULL,
    "team_domain" TEXT,
    "bot_user_id" TEXT,
    "authed_user_id" TEXT,
    "channel_id" TEXT,
    "channel_name" TEXT,
    "access_token_encrypted" TEXT NOT NULL,
    "token_type" TEXT NOT NULL DEFAULT 'bot',
    "scope" TEXT,
    "expires_at" TIMESTAMP(3),
    "status" "SlackConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "senders_user_id_idx" ON "senders"("user_id");

-- CreateIndex
CREATE INDEX "senders_user_id_is_default_idx" ON "senders"("user_id", "is_default");

-- CreateIndex
CREATE UNIQUE INDEX "senders_user_id_from_email_key" ON "senders"("user_id", "from_email");

-- CreateIndex
CREATE INDEX "email_jobs_user_id_status_created_at_idx" ON "email_jobs"("user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "email_jobs_status_scheduled_at_idx" ON "email_jobs"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "email_jobs_sender_id_idx" ON "email_jobs"("sender_id");

-- CreateIndex
CREATE INDEX "email_recipients_user_id_status_scheduled_at_idx" ON "email_recipients"("user_id", "status", "scheduled_at");

-- CreateIndex
CREATE INDEX "email_recipients_user_id_sent_at_idx" ON "email_recipients"("user_id", "sent_at");

-- CreateIndex
CREATE INDEX "email_recipients_status_scheduled_at_idx" ON "email_recipients"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "email_recipients_email_job_id_status_idx" ON "email_recipients"("email_job_id", "status");

-- CreateIndex
CREATE INDEX "email_recipients_email_idx" ON "email_recipients"("email");

-- CreateIndex
CREATE UNIQUE INDEX "email_recipients_idempotency_key_key" ON "email_recipients"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "email_recipients_email_job_id_email_key" ON "email_recipients"("email_job_id", "email");

-- CreateIndex
CREATE INDEX "slack_connections_user_id_status_idx" ON "slack_connections"("user_id", "status");

-- CreateIndex
CREATE INDEX "slack_connections_team_id_idx" ON "slack_connections"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "slack_connections_user_id_team_id_key" ON "slack_connections"("user_id", "team_id");

-- AddForeignKey
ALTER TABLE "senders" ADD CONSTRAINT "senders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_jobs" ADD CONSTRAINT "email_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_jobs" ADD CONSTRAINT "email_jobs_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "senders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_recipients" ADD CONSTRAINT "email_recipients_email_job_id_fkey" FOREIGN KEY ("email_job_id") REFERENCES "email_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_recipients" ADD CONSTRAINT "email_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_connections" ADD CONSTRAINT "slack_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
