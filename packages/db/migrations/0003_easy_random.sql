ALTER TYPE "auction_status" ADD VALUE 'sealed';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "flagged_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"reference_id" uuid,
	"reason" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"metadata" jsonb,
	"reviewed" boolean DEFAULT false NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "flagged_activity_type_time_ix" ON "flagged_activity" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "flagged_activity_reviewed_time_ix" ON "flagged_activity" USING btree ("reviewed","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "flagged_activity_reference_ix" ON "flagged_activity" USING btree ("reference_id");