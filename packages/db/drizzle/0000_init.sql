CREATE TABLE "carts" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"status" text NOT NULL,
	"cart" jsonb NOT NULL,
	"paypal_order_id" text,
	"last_total_cents" integer,
	"completed_response" jsonb,
	"agent_client" text,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carts_status_check" CHECK (status in ('CREATED', 'INCOMPLETE', 'COMPLETED'))
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"order_id" text,
	"status" text NOT NULL,
	"reason" text,
	"decision" text,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"type" text NOT NULL,
	"ref" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "negotiations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"shop_id" text NOT NULL,
	"cart_id" text,
	"agent_client" text,
	"variant_id" text NOT NULL,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome" text,
	"final_unit_cents" integer,
	"floor_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"cart_id" text NOT NULL,
	"paypal_order_id" text,
	"authorization_id" text,
	"capture_id" text,
	"payer_id" text,
	"status" text NOT NULL,
	"total_cents" integer NOT NULL,
	"platform_fee_cents" integer,
	"tracking" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_cart_id_unique" UNIQUE("cart_id"),
	CONSTRAINT "orders_status_check" CHECK (status in ('authorized', 'captured', 'voided', 'refunded', 'disputed'))
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"owner" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"tagline" text NOT NULL,
	"about" text NOT NULL,
	"paypal_merchant_id" text,
	"onboarding_status" text DEFAULT 'not_started' NOT NULL,
	"jwks_mode" text DEFAULT 'sandbox' NOT NULL,
	"policy" jsonb NOT NULL,
	"order_prefix" text NOT NULL,
	"order_seq" integer DEFAULT 10000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shops_slug_unique" UNIQUE("slug"),
	CONSTRAINT "shops_jwks_mode_check" CHECK (jwks_mode in ('sandbox', 'paypal'))
);
--> statement-breakpoint
CREATE TABLE "variants" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"parent_id" text NOT NULL,
	"product_name" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"url" text NOT NULL,
	"price_cents" integer NOT NULL,
	"cost_cents" integer NOT NULL,
	"floor_cents" integer NOT NULL,
	"stock" integer NOT NULL,
	"attributes" jsonb NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"purchasable" boolean DEFAULT true NOT NULL,
	"lead_time_days" integer DEFAULT 0 NOT NULL,
	"weight_g" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"market" jsonb,
	CONSTRAINT "variants_shop_variant_unique" UNIQUE("shop_id","variant_id")
);
--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carts_shop_idx" ON "carts" USING btree ("shop_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "disputes_shop_idx" ON "disputes" USING btree ("shop_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "events_shop_at_idx" ON "events" USING btree ("shop_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "negotiations_shop_idx" ON "negotiations" USING btree ("shop_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_shop_idx" ON "orders" USING btree ("shop_id","created_at" DESC NULLS LAST);