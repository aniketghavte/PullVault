DO $$ BEGIN
 CREATE TYPE "public"."auction_status" AS ENUM('scheduled', 'live', 'extended', 'settling', 'settled', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."drop_status" AS ENUM('scheduled', 'live', 'sold_out', 'closed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."hold_kind" AS ENUM('auction_bid');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."hold_status" AS ENUM('held', 'released', 'consumed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."listing_status" AS ENUM('active', 'sold', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."rarity" AS ENUM('common', 'uncommon', 'rare', 'ultra_rare', 'secret_rare');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."tx_kind" AS ENUM('deposit', 'pack_purchase', 'trade_sale_credit', 'trade_purchase_debit', 'auction_settlement_credit', 'auction_settlement_debit', 'platform_fee', 'bid_hold', 'bid_release', 'bid_consume', 'adjustment');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."user_card_status" AS ENUM('held', 'listed', 'in_auction', 'transferred');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auctions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_card_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"starting_bid_usd" numeric(14, 2) NOT NULL,
	"current_high_bid_id" uuid,
	"current_high_bid_usd" numeric(14, 2),
	"current_high_bidder_id" uuid,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"extensions" integer DEFAULT 0 NOT NULL,
	"anti_snipe_window_seconds" integer NOT NULL,
	"anti_snipe_extension_seconds" integer NOT NULL,
	"status" "auction_status" DEFAULT 'scheduled' NOT NULL,
	"settled_at" timestamp with time zone,
	"winner_id" uuid,
	"final_price_usd" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "balance_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "hold_kind" NOT NULL,
	"reference_id" uuid NOT NULL,
	"amount_usd" numeric(14, 2) NOT NULL,
	"status" "hold_status" DEFAULT 'held' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auction_id" uuid NOT NULL,
	"bidder_id" uuid NOT NULL,
	"amount_usd" numeric(14, 2) NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"caused_extension" boolean DEFAULT false NOT NULL,
	"idempotency_key" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"source" varchar(24) NOT NULL,
	"price_usd" numeric(14, 2) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"set_code" varchar(32) NOT NULL,
	"set_name" text NOT NULL,
	"number" varchar(16) NOT NULL,
	"rarity" "rarity" NOT NULL,
	"image_url" text NOT NULL,
	"market_price_usd" numeric(14, 2) DEFAULT '0' NOT NULL,
	"price_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "tx_kind" NOT NULL,
	"user_id" uuid,
	"counterparty_id" uuid,
	"amount_usd" numeric(14, 2) NOT NULL,
	"reference_table" varchar(32) NOT NULL,
	"reference_id" uuid NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_card_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"price_usd" numeric(14, 2) NOT NULL,
	"status" "listing_status" DEFAULT 'active' NOT NULL,
	"buyer_id" uuid,
	"sold_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pack_drops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tier_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"total_inventory" integer NOT NULL,
	"remaining_inventory" integer NOT NULL,
	"status" "drop_status" DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pack_purchase_cards" (
	"purchase_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"card_id" uuid NOT NULL,
	"draw_price_usd" numeric(14, 2) NOT NULL,
	CONSTRAINT "pack_purchase_cards_purchase_id_position_pk" PRIMARY KEY("purchase_id","position")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pack_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"drop_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"price_paid_usd" numeric(14, 2) NOT NULL,
	"idempotency_key" varchar(64) NOT NULL,
	"sealed" boolean DEFAULT true NOT NULL,
	"opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pack_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(24) NOT NULL,
	"name" text NOT NULL,
	"price_usd" numeric(14, 2) NOT NULL,
	"cards_per_pack" integer NOT NULL,
	"rarity_weights" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pack_tiers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portfolio_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"total_value_usd" numeric(14, 2) NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"handle" varchar(24) NOT NULL,
	"email" text NOT NULL,
	"available_balance_usd" numeric(14, 2) DEFAULT '0' NOT NULL,
	"held_balance_usd" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"acquired_from" varchar(24) NOT NULL,
	"source_ref_id" uuid,
	"acquired_price_usd" numeric(14, 2) NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "user_card_status" DEFAULT 'held' NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auctions" ADD CONSTRAINT "auctions_user_card_id_user_cards_id_fk" FOREIGN KEY ("user_card_id") REFERENCES "public"."user_cards"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auctions" ADD CONSTRAINT "auctions_seller_id_profiles_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auctions" ADD CONSTRAINT "auctions_current_high_bidder_id_profiles_id_fk" FOREIGN KEY ("current_high_bidder_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auctions" ADD CONSTRAINT "auctions_winner_id_profiles_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "balance_holds" ADD CONSTRAINT "balance_holds_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bids" ADD CONSTRAINT "bids_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bids" ADD CONSTRAINT "bids_bidder_id_profiles_id_fk" FOREIGN KEY ("bidder_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_prices" ADD CONSTRAINT "card_prices_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_counterparty_id_profiles_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listings" ADD CONSTRAINT "listings_user_card_id_user_cards_id_fk" FOREIGN KEY ("user_card_id") REFERENCES "public"."user_cards"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listings" ADD CONSTRAINT "listings_seller_id_profiles_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listings" ADD CONSTRAINT "listings_buyer_id_profiles_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pack_drops" ADD CONSTRAINT "pack_drops_tier_id_pack_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."pack_tiers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pack_purchase_cards" ADD CONSTRAINT "pack_purchase_cards_purchase_id_pack_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."pack_purchases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pack_purchase_cards" ADD CONSTRAINT "pack_purchase_cards_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pack_purchases" ADD CONSTRAINT "pack_purchases_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pack_purchases" ADD CONSTRAINT "pack_purchases_drop_id_pack_drops_id_fk" FOREIGN KEY ("drop_id") REFERENCES "public"."pack_drops"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pack_purchases" ADD CONSTRAINT "pack_purchases_tier_id_pack_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."pack_tiers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auctions_active_one_per_card_ux" ON "auctions" USING btree ("user_card_id") WHERE status in ('scheduled','live','extended','settling');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auctions_status_ix" ON "auctions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auctions_end_at_ix" ON "auctions" USING btree ("end_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auctions_seller_ix" ON "auctions" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "balance_holds_user_status_ix" ON "balance_holds" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "balance_holds_reference_ix" ON "balance_holds" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bids_auction_time_ix" ON "bids" USING btree ("auction_id","placed_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bids_bidder_idem_ux" ON "bids" USING btree ("bidder_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_prices_card_time_ix" ON "card_prices" USING btree ("card_id","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cards_external_id_ux" ON "cards" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_rarity_ix" ON "cards" USING btree ("rarity");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_set_ix" ON "cards" USING btree ("set_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_user_ix" ON "ledger_entries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_reference_ix" ON "ledger_entries" USING btree ("reference_table","reference_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_kind_ix" ON "ledger_entries" USING btree ("kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "listings_active_one_per_card_ux" ON "listings" USING btree ("user_card_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_seller_ix" ON "listings" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_status_ix" ON "listings" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pack_drops_scheduled_ix" ON "pack_drops" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pack_drops_status_ix" ON "pack_drops" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pack_purchases_user_idem_ux" ON "pack_purchases" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pack_purchases_user_ix" ON "pack_purchases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pack_purchases_drop_ix" ON "pack_purchases" USING btree ("drop_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portfolio_snapshots_user_time_ix" ON "portfolio_snapshots" USING btree ("user_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_handle_lower_ux" ON "profiles" USING btree (lower("handle"));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_email_lower_ux" ON "profiles" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_cards_owner_status_ix" ON "user_cards" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_cards_card_ix" ON "user_cards" USING btree ("card_id");