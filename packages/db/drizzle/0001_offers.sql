CREATE TABLE "offers" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"agent_client" text NOT NULL,
	"lines" jsonb NOT NULL,
	"discount_cents" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offers_agent_idx" ON "offers" USING btree ("shop_id","agent_client","expires_at" DESC NULLS LAST);