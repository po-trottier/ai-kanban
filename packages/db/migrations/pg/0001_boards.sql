ALTER TABLE "boards" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "archived_at" text;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "access_mode" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "allowed_role_keys" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "allowed_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "allowed_group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Deterministically flag the pre-existing (v1 single-board) row as default —
-- the earliest-created board wins the tie-break; an empty table is a no-op
-- (the subquery returns NULL, matching no row).
UPDATE "boards" SET "is_default" = true WHERE "id" = (SELECT "id" FROM "boards" ORDER BY "created_at" ASC, "id" ASC LIMIT 1);--> statement-breakpoint
CREATE UNIQUE INDEX "boards_is_default_unique" ON "boards" USING btree ("is_default") WHERE "boards"."is_default" = true;--> statement-breakpoint
-- Postgres refuses ADD COLUMN ... NOT NULL without a DEFAULT on a populated
-- table, so board_id is added nullable, backfilled to the (now-flagged)
-- default board, then locked to NOT NULL.
ALTER TABLE "filter_presets" ADD COLUMN "board_id" text;--> statement-breakpoint
UPDATE "filter_presets" SET "board_id" = (SELECT "id" FROM "boards" WHERE "is_default" = true LIMIT 1);--> statement-breakpoint
ALTER TABLE "filter_presets" ALTER COLUMN "board_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "filter_presets" ADD CONSTRAINT "filter_presets_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DROP INDEX "filter_presets_shared_created_at_idx";--> statement-breakpoint
CREATE INDEX "filter_presets_shared_board_id_created_at_idx" ON "filter_presets" USING btree ("board_id","created_at") WHERE "filter_presets"."shared" = true;--> statement-breakpoint
-- Global user groups (multiple-boards: `boards.allowed_group_ids` references
-- these by id). Case-insensitive name uniqueness is the race backstop for
-- BoardService's lock-held duplicate check.
CREATE TABLE "groups" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "groups_name_ci_unique" ON "groups" USING btree (lower("name"));--> statement-breakpoint
-- Native sequence backing CardRepository.nextCardId (global, per-engine
-- allocation — cards.id itself stays app-assigned, not a serial column), now
-- tracked in schema.pg.ts as `cardIdsSeq` so drizzle-kit's snapshot/diffing
-- knows about it. This CREATE is drizzle-generated; the setval() below is a
-- hand-written, data-dependent backfill drizzle-kit cannot generate.
CREATE SEQUENCE "public"."card_ids" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
-- setval(..., false) makes the NEXT nextval() call return exactly this value,
-- so an empty table starts at 1 and a populated one resumes above MAX(id).
-- Initialized ONCE here; nextCardId() only ever calls nextval() afterward —
-- never re-running setval — so a live production sequence is never reset.
SELECT setval('card_ids', COALESCE((SELECT MAX(id) FROM cards), 0) + 1, false);
