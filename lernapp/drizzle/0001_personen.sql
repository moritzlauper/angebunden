CREATE TABLE "learner_setting" (
	"user_id" text NOT NULL,
	"subject_id" integer NOT NULL,
	"ue_limit" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learner_setting_user_id_subject_id_pk" PRIMARY KEY("user_id","subject_id")
);
--> statement-breakpoint
ALTER TABLE "answer" ALTER COLUMN "user_id" SET DEFAULT 'moritz';--> statement-breakpoint
ALTER TABLE "card_state" ALTER COLUMN "user_id" SET DEFAULT 'moritz';--> statement-breakpoint
ALTER TABLE "practice_session" ALTER COLUMN "user_id" SET DEFAULT 'moritz';--> statement-breakpoint
ALTER TABLE "report" ALTER COLUMN "user_id" SET DEFAULT 'moritz';--> statement-breakpoint
ALTER TABLE "learner_setting" ADD CONSTRAINT "learner_setting_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Bisheriger Lernstand gehört Moritz (vorher fest «me»).
UPDATE "practice_session" SET "user_id" = 'moritz' WHERE "user_id" = 'me';--> statement-breakpoint
UPDATE "answer" SET "user_id" = 'moritz' WHERE "user_id" = 'me';--> statement-breakpoint
UPDATE "card_state" SET "user_id" = 'moritz' WHERE "user_id" = 'me';--> statement-breakpoint
UPDATE "report" SET "user_id" = 'moritz' WHERE "user_id" = 'me';
