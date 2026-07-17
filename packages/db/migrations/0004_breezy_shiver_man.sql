ALTER TABLE `cards` ADD `number` integer NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `cards_board_id_number_unique` ON `cards` (`board_id`,`number`);