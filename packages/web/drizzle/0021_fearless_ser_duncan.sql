ALTER TABLE "user_requests" ALTER COLUMN "id" SET DEFAULT '8191e6bb-ce50-4f16-815e-4b60ddadd4cc';--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "primary_safe_address" varchar(42);