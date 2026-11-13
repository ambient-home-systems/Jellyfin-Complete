CREATE TABLE `overlay` (
	`jf_id` text PRIMARY KEY NOT NULL,
	`badges` text NOT NULL,
	`file` text NOT NULL,
	`content_type` text NOT NULL,
	`original_tag` text,
	`applied_tag` text,
	`applied_hash` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `library_item` ADD `status` text;