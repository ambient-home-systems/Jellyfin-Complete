CREATE TABLE `action` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer,
	`type` text NOT NULL,
	`fingerprint` text NOT NULL,
	`definition_id` integer,
	`item` text,
	`payload` text,
	`mode` text NOT NULL,
	`reason` text,
	`status` text NOT NULL,
	`apply_at` integer,
	`before` text,
	`after` text,
	`undo_of` integer,
	`decided_by` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`decided_at` integer,
	`applied_at` integer
);
--> statement-breakpoint
CREATE INDEX `action_fingerprint` ON `action` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `action_status` ON `action` (`status`);--> statement-breakpoint
CREATE TABLE `decision` (
	`fingerprint` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`until` integer,
	`decided_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `definition` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`target` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`preset_key` text,
	`preset_rev` text,
	`window` text,
	`filters` text DEFAULT '{}' NOT NULL,
	`library_ids` text,
	`min_items` integer DEFAULT 1 NOT NULL,
	`sync_mode` text DEFAULT 'sync' NOT NULL,
	`sort_by` text DEFAULT 'title.asc' NOT NULL,
	`sort_title` text,
	`overview` text,
	`poster` text DEFAULT '{"kind":"none"}' NOT NULL,
	`visibility` text DEFAULT 'delete' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `definition_slug` ON `definition` (`slug`);--> statement-breakpoint
CREATE TABLE `definition_mode` (
	`definition_id` integer NOT NULL,
	`action_type` text NOT NULL,
	`mode` text NOT NULL,
	PRIMARY KEY(`definition_id`, `action_type`)
);
--> statement-breakpoint
CREATE TABLE `definition_source` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`definition_id` integer NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`role` text DEFAULT 'add' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `imdb_hash` (
	`name` text PRIMARY KEY NOT NULL,
	`value` text,
	`last_good` text,
	`checked_at` integer,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `job_schedule` (
	`job` text PRIMARY KEY NOT NULL,
	`cron` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_run_at` integer
);
--> statement-breakpoint
CREATE TABLE `library` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`collection_type` text,
	`seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `library_item` (
	`jf_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`library_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_name` text,
	`year` integer,
	`imdb` text,
	`tmdb` text,
	`tvdb` text,
	`series_jf_id` text,
	`season` integer,
	`episode` integer,
	`official_rating` text,
	`genres` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`studios` text DEFAULT '[]' NOT NULL,
	`date_added` integer,
	`seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `library_item_imdb` ON `library_item` (`imdb`);--> statement-breakpoint
CREATE INDEX `library_item_tmdb` ON `library_item` (`tmdb`);--> statement-breakpoint
CREATE INDEX `library_item_tvdb` ON `library_item` (`tvdb`);--> statement-breakpoint
CREATE INDEX `library_item_kind` ON `library_item` (`kind`);--> statement-breakpoint
CREATE TABLE `managed_collection` (
	`definition_id` integer PRIMARY KEY NOT NULL,
	`jf_boxset_id` text,
	`origin` text NOT NULL,
	`state` text NOT NULL,
	`saved_meta` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `membership` (
	`definition_id` integer NOT NULL,
	`jf_id` text NOT NULL,
	`provenance` text NOT NULL,
	`since` integer NOT NULL,
	`action_id` integer,
	PRIMARY KEY(`definition_id`, `jf_id`)
);
--> statement-breakpoint
CREATE TABLE `pin` (
	`definition_id` integer NOT NULL,
	`jf_id` text NOT NULL,
	`kind` text NOT NULL,
	PRIMARY KEY(`definition_id`, `jf_id`)
);
--> statement-breakpoint
CREATE TABLE `run` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job` text NOT NULL,
	`trigger` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`stats` text DEFAULT '{}' NOT NULL,
	`log` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `secret` (
	`name` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`last4` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`user_name` text NOT NULL,
	`csrf` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_result` (
	`source_key` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`fetched_at` integer,
	`items` text,
	`meta` text,
	`last_good_at` integer
);
--> statement-breakpoint
CREATE TABLE `tmdb_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`payload` text,
	`fetched_at` integer NOT NULL,
	`ttl_days` integer NOT NULL
);
