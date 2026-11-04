CREATE TABLE `definition_arr` (
	`definition_id` integer PRIMARY KEY NOT NULL,
	`add_missing` integer DEFAULT false NOT NULL,
	`options` text DEFAULT '{}' NOT NULL
);
