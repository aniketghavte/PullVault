ALTER TABLE "pack_tiers" ADD COLUMN "rebalanced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pack_tiers" ADD COLUMN "rebalanced_reason" text;--> statement-breakpoint
ALTER TABLE "pack_tiers" ADD COLUMN "previous_weights" jsonb;