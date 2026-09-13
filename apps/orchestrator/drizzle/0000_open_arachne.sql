CREATE TABLE "learning_gaps" (
	"gap_id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"topic" text NOT NULL,
	"description" text NOT NULL,
	"affected_student_ids" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"addressed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"uid" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text NOT NULL,
	"proficiency" text,
	"joined_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "quiz_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"quiz_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"answer" text NOT NULL,
	"correct" boolean NOT NULL,
	"via" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_questions" (
	"quiz_id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"topic" text NOT NULL,
	"question" text NOT NULL,
	"options" jsonb,
	"correct_answer" text NOT NULL,
	"difficulty" text NOT NULL,
	"target_student_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"origin" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"session_id" text PRIMARY KEY NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"narrative" text NOT NULL,
	"report" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transcript_segments" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"participant_id" text,
	"uid" text NOT NULL,
	"speaker" text NOT NULL,
	"text" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"language" text,
	"turn_id" integer,
	"attribution_confidence" real
);
--> statement-breakpoint
ALTER TABLE "learning_gaps" ADD CONSTRAINT "learning_gaps_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_quiz_id_quiz_questions_quiz_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quiz_questions"("quiz_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_gaps_session_idx" ON "learning_gaps" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "participants_session_idx" ON "participants" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "quiz_answers_session_idx" ON "quiz_answers" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "quiz_questions_session_idx" ON "quiz_questions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "transcript_session_idx" ON "transcript_segments" USING btree ("session_id");