ALTER TABLE "pack_purchase_cards" ADD COLUMN "draw_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pack_purchases" ADD COLUMN "server_seed" text;--> statement-breakpoint
ALTER TABLE "pack_purchases" ADD COLUMN "server_seed_hash" text;--> statement-breakpoint
ALTER TABLE "pack_purchases" ADD COLUMN "client_seed" text;--> statement-breakpoint
ALTER TABLE "pack_purchases" ADD COLUMN "nonce" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pack_purchases" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
UPDATE "pack_purchases"
SET "server_seed_hash" = 'legacy-purchase-not-verifiable'
WHERE "server_seed_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "pack_purchases" ALTER COLUMN "server_seed_hash" SET NOT NULL;