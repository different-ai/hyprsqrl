CREATE TABLE "ledger_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_did" text NOT NULL,
	"event_type" text NOT NULL,
	"amount" text NOT NULL,
	"currency" text NOT NULL,
	"related_invoice_id" text,
	"source" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_requests" ALTER COLUMN "id" SET DEFAULT 'cfc1d8bc-b7ee-4610-9acf-15417685b591';--> statement-breakpoint
ALTER TABLE "ledger_events" ADD CONSTRAINT "ledger_events_user_did_users_privy_did_fk" FOREIGN KEY ("user_did") REFERENCES "public"."users"("privy_did") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_events_user_idx" ON "ledger_events" USING btree ("user_did");--> statement-breakpoint
CREATE INDEX "ledger_events_type_idx" ON "ledger_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "ledger_events_created_idx" ON "ledger_events" USING btree ("created_at");