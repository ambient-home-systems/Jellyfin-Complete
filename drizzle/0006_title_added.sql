CREATE TABLE `title_added` (
	`key` text PRIMARY KEY NOT NULL,
	`first_added` integer NOT NULL,
	`last_seen` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `library_item` ADD `first_added` integer;