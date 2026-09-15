CREATE TABLE `board_defaults` (
	`scope` text NOT NULL,
	`subject` text NOT NULL,
	`board_id` text NOT NULL,
	PRIMARY KEY(`scope`, `subject`),
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action
);
