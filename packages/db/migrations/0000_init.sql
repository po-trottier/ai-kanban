CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` integer NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage_key` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attachments_card_id_idx` ON `attachments` (`card_id`);--> statement-breakpoint
CREATE TABLE `board_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`config` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `board_policies_board_id_created_at_idx` ON `board_policies` (`board_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `boards` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `card_events` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` integer NOT NULL,
	`actor_id` text,
	`actor_kind` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `card_events_card_id_created_at_idx` ON `card_events` (`card_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `card_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`from_card_id` integer NOT NULL,
	`to_card_id` integer NOT NULL,
	`type` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`from_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_relations_from_to_type_unique` ON `card_relations` (`from_card_id`,`to_card_id`,`type`);--> statement-breakpoint
CREATE INDEX `card_relations_from_card_idx` ON `card_relations` (`from_card_id`);--> statement-breakpoint
CREATE INDEX `card_relations_to_card_idx` ON `card_relations` (`to_card_id`);--> statement-breakpoint
CREATE TABLE `card_tags` (
	`card_id` integer NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`card_id`, `tag_id`),
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `card_watchers` (
	`card_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`card_id`, `user_id`),
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cards` (
	`id` integer PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`lane_id` text NOT NULL,
	`position` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`priority` text NOT NULL,
	`estimate_minutes` integer,
	`reporter_id` text NOT NULL,
	`assignee_id` text,
	`location_id` text,
	`origin` text NOT NULL,
	`resolution` text,
	`blocked` integer DEFAULT false NOT NULL,
	`blocked_reason` text,
	`blocked_at` text,
	`waiting_reason` text,
	`expected_resume_at` text,
	`resume_alerted_at` text,
	`work_started_at` text,
	`slack_channel_id` text,
	`slack_thread_ts` text,
	`slack_permalink` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lane_id`) REFERENCES `lanes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_lane_id_position_unique` ON `cards` (`lane_id`,`position`);--> statement-breakpoint
CREATE INDEX `cards_board_id_archived_at_idx` ON `cards` (`board_id`,`archived_at`);--> statement-breakpoint
CREATE INDEX `cards_assignee_id_idx` ON `cards` (`assignee_id`);--> statement-breakpoint
CREATE INDEX `cards_reporter_id_idx` ON `cards` (`reporter_id`);--> statement-breakpoint
CREATE INDEX `cards_created_at_id_idx` ON `cards` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `cards_lane_active_position_idx` ON `cards` (`lane_id`,`position`) WHERE "cards"."archived_at" is null;--> statement-breakpoint
CREATE INDEX `cards_blocked_active_idx` ON `cards` (`created_at`,`id`) WHERE "cards"."blocked" = 1 and "cards"."archived_at" is null;--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` integer NOT NULL,
	`parent_comment_id` text,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `comments_card_id_created_at_idx` ON `comments` (`card_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `filter_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`filter` text NOT NULL,
	`shared` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `filter_presets_owner_id_created_at_idx` ON `filter_presets` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `filter_presets_shared_created_at_idx` ON `filter_presets` (`created_at`) WHERE "filter_presets"."shared" = 1;--> statement-breakpoint
CREATE TABLE `lanes` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`position` integer NOT NULL,
	`wip_limit` integer,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lanes_board_id_key_unique` ON `lanes` (`board_id`,`key`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`card_id` integer NOT NULL,
	`actor_id` text,
	`event_type` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notifications_user_id_created_at_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `service_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`role` text NOT NULL,
	`scope` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_tokens_token_hash_unique` ON `service_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text COLLATE NOCASE NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`password_hash` text NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`slack_user_id` text,
	`is_active` integer NOT NULL,
	`timezone` text DEFAULT 'America/Los_Angeles' NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_ci_unique` ON `users` (lower("email"));--> statement-breakpoint
CREATE INDEX `users_display_name_ci_idx` ON `users` (lower("display_name"));