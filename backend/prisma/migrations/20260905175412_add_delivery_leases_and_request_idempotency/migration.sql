-- AlterTable
ALTER TABLE "email_jobs" ADD COLUMN     "idempotency_key" TEXT;

-- AlterTable
ALTER TABLE "email_recipients" ADD COLUMN     "locked_at" TIMESTAMP(3),
ADD COLUMN     "locked_by" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "email_jobs_user_id_idempotency_key_key" ON "email_jobs"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "email_recipients_status_locked_at_idx" ON "email_recipients"("status", "locked_at");

