CREATE TABLE `health_finding` (
	`jf_id` text NOT NULL,
	`kind` text NOT NULL,
	`detail` text NOT NULL,
	`sig` text NOT NULL,
	`first_seen` integer NOT NULL,
	`dismissed_at` integer,
	`dismissed_by` text,
	PRIMARY KEY(`jf_id`, `kind`)
);
--> statement-breakpoint
CREATE TABLE `media_check` (
	`jf_id` text PRIMARY KEY NOT NULL,
	`sig` text NOT NULL,
	`duration_min` real,
	`titles` text DEFAULT '[]' NOT NULL,
	`path` text,
	`checked_at` integer NOT NULL
);
