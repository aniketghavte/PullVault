CREATE TABLE IF NOT EXISTS "bot_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"ip" text,
	"signal_type" text NOT NULL,
	"value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_limit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"ip" text,
	"endpoint" text NOT NULL,
	"limit_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "suspicious_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bot_score" integer DEFAULT 0 NOT NULL,
	"flagged_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suspicious_accounts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bot_signals" ADD CONSTRAINT "bot_signals_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rate_limit_events" ADD CONSTRAINT "rate_limit_events_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "suspicious_accounts" ADD CONSTRAINT "suspicious_accounts_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bot_signals_user_time_ix" ON "bot_signals" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bot_signals_type_time_ix" ON "bot_signals" USING btree ("signal_type","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limit_events_created_ix" ON "rate_limit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limit_events_user_time_ix" ON "rate_limit_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limit_events_endpoint_time_ix" ON "rate_limit_events" USING btree ("endpoint","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "suspicious_accounts_score_ix" ON "suspicious_accounts" USING btree ("bot_score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "suspicious_accounts_flagged_ix" ON "suspicious_accounts" USING btree ("flagged_at");