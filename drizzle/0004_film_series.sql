ALTER TABLE `library_item` ADD `tmdb_collection` text;--> statement-breakpoint
CREATE INDEX `library_item_tmdb_collection` ON `library_item` (`tmdb_collection`);