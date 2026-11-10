CREATE TABLE `pageview_daily` (
	`day` text NOT NULL,
	`path` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `path`)
);
