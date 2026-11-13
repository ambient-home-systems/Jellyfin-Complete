CREATE TABLE `integrity_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`definition_id` integer NOT NULL,
	`name` text NOT NULL,
	`what` text NOT NULL,
	`ok` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `library` ADD `auto_collections` integer;--> statement-breakpoint
ALTER TABLE `managed_collection` ADD `artwork` text;