ALTER TABLE `boards` ADD `is_default` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `boards` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `boards` ADD `access_mode` text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE `boards` ADD `allowed_role_keys` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `boards` ADD `allowed_user_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `boards` ADD `allowed_group_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
-- Deterministically flag the pre-existing (v1 single-board) row as default —
-- the earliest-created board wins the tie-break; a fresh/empty table is a
-- no-op (the WHERE subquery returns NULL, matching no row).
UPDATE `boards` SET `is_default` = 1 WHERE `id` = (SELECT `id` FROM `boards` ORDER BY `created_at` ASC, `id` ASC LIMIT 1);--> statement-breakpoint
CREATE UNIQUE INDEX `boards_is_default_unique` ON `boards` (`is_default`) WHERE "boards"."is_default" = 1;--> statement-breakpoint
-- SQLite refuses `ALTER TABLE ... ADD` for a NOT NULL column carrying a
-- REFERENCES clause together with a DEFAULT, so filter_presets is rebuilt
-- (the standard SQLite 12-step ALTER pattern) to add board_id with a real FK,
-- backfilling every existing row to the (now-flagged) default board.
DROP INDEX `filter_presets_shared_created_at_idx`;--> statement-breakpoint
CREATE TABLE `__new_filter_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`board_id` text NOT NULL,
	`name` text NOT NULL,
	`filter` text NOT NULL,
	`shared` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_filter_presets` (`id`, `owner_id`, `board_id`, `name`, `filter`, `shared`, `created_at`, `updated_at`)
SELECT `id`, `owner_id`, (SELECT `id` FROM `boards` WHERE `is_default` = 1 LIMIT 1), `name`, `filter`, `shared`, `created_at`, `updated_at` FROM `filter_presets`;--> statement-breakpoint
DROP TABLE `filter_presets`;--> statement-breakpoint
ALTER TABLE `__new_filter_presets` RENAME TO `filter_presets`;--> statement-breakpoint
CREATE INDEX `filter_presets_owner_id_created_at_idx` ON `filter_presets` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `filter_presets_shared_board_id_created_at_idx` ON `filter_presets` (`board_id`,`created_at`) WHERE "filter_presets"."shared" = 1;--> statement-breakpoint
-- Global user groups (multiple-boards: `boards.allowed_group_ids` references
-- these by id). Case-insensitive name uniqueness is the race backstop for
-- BoardService's lock-held duplicate check.
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`user_ids` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_name_ci_unique` ON `groups` (lower(`name`));
