ALTER TABLE `definition` ADD `home_row` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Seasonal films and holiday episodes show as home-screen rows by default (only while live, and only once rows are turned on in Settings).
UPDATE `definition` SET `home_row` = 1 WHERE `preset_key` LIKE 'seasonal:%' OR `preset_key` LIKE 'holiday_episodes:%';
