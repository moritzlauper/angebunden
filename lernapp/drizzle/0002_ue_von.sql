ALTER TABLE "learner_setting" ADD COLUMN "ue_from" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "practice_session" ADD COLUMN "ue_from" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "subject" ADD COLUMN "ue_from" integer DEFAULT 1 NOT NULL;