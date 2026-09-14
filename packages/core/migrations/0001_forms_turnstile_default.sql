-- Change the default of forms.turnstile from true to false (Turnstile is opt-in per form).
-- SQLite cannot alter a column default, so `forms` is rebuilt. Hand-written instead of the
-- drizzle-kit output: D1 runs every migration inside an implicit transaction, where
-- `PRAGMA foreign_keys = OFF` has no effect, so `DROP TABLE forms` would cascade-delete every
-- row of `form_submissions`. Both tables are rebuilt and the old child is dropped before the old
-- parent; `ALTER TABLE ... RENAME` rewrites the foreign key reference to the final table name.
CREATE TABLE `__new_forms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`fields_json` text NOT NULL,
	`notify_to` text DEFAULT '' NOT NULL,
	`success_message` text DEFAULT '' NOT NULL,
	`redirect_url` text,
	`turnstile` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_forms`("id", "slug", "name", "fields_json", "notify_to", "success_message", "redirect_url", "turnstile", "created_at", "updated_at") SELECT "id", "slug", "name", "fields_json", "notify_to", "success_message", "redirect_url", "turnstile", "created_at", "updated_at" FROM `forms`;--> statement-breakpoint
CREATE TABLE `__new_form_submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`form_id` integer NOT NULL,
	`data_json` text NOT NULL,
	`meta_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`form_id`) REFERENCES `__new_forms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_form_submissions`("id", "form_id", "data_json", "meta_json", "created_at", "read_at") SELECT "id", "form_id", "data_json", "meta_json", "created_at", "read_at" FROM `form_submissions`;--> statement-breakpoint
DROP TABLE `form_submissions`;--> statement-breakpoint
DROP TABLE `forms`;--> statement-breakpoint
ALTER TABLE `__new_forms` RENAME TO `forms`;--> statement-breakpoint
ALTER TABLE `__new_form_submissions` RENAME TO `form_submissions`;--> statement-breakpoint
CREATE UNIQUE INDEX `forms_slug_unique` ON `forms` (`slug`);--> statement-breakpoint
CREATE INDEX `form_submissions_form_created_idx` ON `form_submissions` (`form_id`,`created_at`);
