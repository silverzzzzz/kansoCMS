DROP INDEX `pages_path_unique`;--> statement-breakpoint
ALTER TABLE `pages` ADD `deleted_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `pages_path_uq` ON `pages` (`path`) WHERE "pages"."deleted_at" is null;--> statement-breakpoint
DROP INDEX `posts_type_slug_uq`;--> statement-breakpoint
ALTER TABLE `posts` ADD `deleted_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `posts_type_slug_uq` ON `posts` (`post_type_id`,`slug`) WHERE "posts"."deleted_at" is null;