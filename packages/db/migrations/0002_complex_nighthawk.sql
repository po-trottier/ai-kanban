CREATE INDEX `cards_lane_active_position_idx` ON `cards` (`lane_id`,`position`) WHERE "cards"."archived_at" is null;--> statement-breakpoint
CREATE INDEX `cards_blocked_active_idx` ON `cards` (`created_at`,`id`) WHERE "cards"."blocked" = 1 and "cards"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `service_tokens_token_hash_unique` ON `service_tokens` (`token_hash`);