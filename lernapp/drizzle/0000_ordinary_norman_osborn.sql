CREATE TABLE "answer" (
	"id" serial PRIMARY KEY NOT NULL,
	"question_id" integer,
	"statement_id" integer NOT NULL,
	"user_id" text DEFAULT 'me' NOT NULL,
	"marked" boolean NOT NULL,
	"correct" boolean NOT NULL,
	"guessed" boolean DEFAULT false NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_state" (
	"user_id" text DEFAULT 'me' NOT NULL,
	"statement_id" integer NOT NULL,
	"due" timestamp with time zone NOT NULL,
	"stability" double precision NOT NULL,
	"difficulty" double precision NOT NULL,
	"scheduled_days" integer DEFAULT 0 NOT NULL,
	"learning_steps" integer DEFAULT 0 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"state" integer DEFAULT 0 NOT NULL,
	"last_review" timestamp with time zone,
	CONSTRAINT "card_state_user_id_statement_id_pk" PRIMARY KEY("user_id","statement_id")
);
--> statement-breakpoint
CREATE TABLE "check" (
	"id" serial PRIMARY KEY NOT NULL,
	"statement_id" integer NOT NULL,
	"checker_truth" text NOT NULL,
	"agrees" boolean NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comment" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunk" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"unit_id" integer,
	"page" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"heading" text,
	"text" text NOT NULL,
	"pdf_selection" text
);
--> statement-breakpoint
CREATE TABLE "practice_session" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_id" integer NOT NULL,
	"user_id" text DEFAULT 'me' NOT NULL,
	"channel" text DEFAULT 'web' NOT NULL,
	"ue_limit" integer NOT NULL,
	"exam_mode" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "question" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"position" integer NOT NULL,
	"stem" text NOT NULL,
	"unit_number" integer,
	"statement_ids" jsonb NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "report" (
	"id" serial PRIMARY KEY NOT NULL,
	"statement_id" integer NOT NULL,
	"user_id" text DEFAULT 'me' NOT NULL,
	"comment" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_id" integer NOT NULL,
	"kind" text NOT NULL,
	"path" text NOT NULL,
	"hash" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statement" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_id" integer NOT NULL,
	"text" text NOT NULL,
	"truth" text NOT NULL,
	"reason" text,
	"quote" text,
	"source_ref" text,
	"chunk_id" integer,
	"topic" text,
	"manipulation_type" text,
	"parent_id" integer,
	"status" text DEFAULT 'inbox' NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin" text DEFAULT 'claude' NOT NULL,
	"hard" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "style_example" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_id" integer NOT NULL,
	"unit_number" integer,
	"kind" text DEFAULT 'olat' NOT NULL,
	"source_label" text,
	"stem" text NOT NULL,
	"options" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subject" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"course_code" text,
	"dozent" text,
	"vault_path" text,
	"vault_name" text,
	"slides_pattern" text DEFAULT 'Slides/VL{n}.pdf',
	"zm_path" text,
	"ue_limit" integer DEFAULT 1 NOT NULL,
	"exam_date" date,
	"exam_mode" boolean DEFAULT false NOT NULL,
	"questions_per_session" integer DEFAULT 5 NOT NULL,
	"auto_approve" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subject_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "unit" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_id" integer NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"notes_hash" text,
	"slides_until" integer
);
--> statement-breakpoint
ALTER TABLE "answer" ADD CONSTRAINT "answer_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer" ADD CONSTRAINT "answer_statement_id_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."statement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_state" ADD CONSTRAINT "card_state_statement_id_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."statement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check" ADD CONSTRAINT "check_statement_id_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."statement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunk" ADD CONSTRAINT "chunk_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunk" ADD CONSTRAINT "chunk_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_session" ADD CONSTRAINT "practice_session_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_session_id_practice_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_statement_id_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."statement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source" ADD CONSTRAINT "source_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement" ADD CONSTRAINT "statement_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement" ADD CONSTRAINT "statement_chunk_id_chunk_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunk"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_example" ADD CONSTRAINT "style_example_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answer_statement" ON "answer" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "chunk_unit" ON "chunk" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "chunk_source" ON "chunk" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_subject_path" ON "source" USING btree ("subject_id","path");--> statement-breakpoint
CREATE INDEX "statement_unit" ON "statement" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "statement_status" ON "statement" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_subject_number" ON "unit" USING btree ("subject_id","number");