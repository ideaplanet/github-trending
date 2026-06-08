CREATE TABLE `repo` (
	`full_name` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`language` text,
	`language_color` text,
	`stars` integer DEFAULT 0 NOT NULL,
	`forks` integer DEFAULT 0 NOT NULL,
	`html_url` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repo_trending` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`full_name` text NOT NULL,
	`period` text NOT NULL,
	`period_date` text NOT NULL,
	`rank` integer NOT NULL,
	`today_star` integer NOT NULL,
	`stars_at_capture` integer NOT NULL,
	`forks_at_capture` integer NOT NULL,
	`captured_at` integer NOT NULL,
	`first_captured_at` integer NOT NULL,
	`update_count` integer DEFAULT 1 NOT NULL,
	`is_latest` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`full_name`) REFERENCES `repo`(`full_name`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_trending_slot` ON `repo_trending` (`period`,`period_date`,`full_name`);--> statement-breakpoint
CREATE INDEX `idx_trending_latest` ON `repo_trending` (`period`,`is_latest`,`rank`);--> statement-breakpoint
CREATE INDEX `idx_trending_repo` ON `repo_trending` (`full_name`,`period`,`captured_at`);