CREATE TABLE `artwork_check` (
	`jf_id` text PRIMARY KEY NOT NULL,
	`sig` text NOT NULL,
	`checked_at` integer NOT NULL,
	`verified_tmdb` text,
	`verified_by` text,
	`poster` text,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `artwork_fix` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`jf_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`by` text NOT NULL,
	`tmdb` text NOT NULL,
	`what` text NOT NULL,
	`backups` text NOT NULL,
	`undone_at` integer,
	`undone_by` text
);
--> statement-breakpoint
CREATE TABLE `image_hash` (
	`path` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `health_finding` ADD `proposal` text;--> statement-breakpoint
ALTER TABLE `health_finding` ADD `subject` text;--> statement-breakpoint
ALTER TABLE `library` ADD `preferred_language` text;--> statement-breakpoint
ALTER TABLE `library` ADD `image_fetchers` text;--> statement-breakpoint
ALTER TABLE `library_item` ADD `primary_tag` text;--> statement-breakpoint
ALTER TABLE `library_item` ADD `path` text;--> statement-breakpoint
ALTER TABLE `media_check` ADD `probe_v` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `media_check` ADD `audio` text;--> statement-breakpoint
ALTER TABLE `media_check` ADD `embedded_image` text;