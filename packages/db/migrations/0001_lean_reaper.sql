CREATE INDEX `cards_created_at_id_idx` ON `cards` (`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_ci_unique` ON `users` (lower("email"));