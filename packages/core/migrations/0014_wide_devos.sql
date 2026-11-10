ALTER TABLE `users` ADD `slug` text;--> statement-breakpoint
ALTER TABLE `users` ADD `bio` text;--> statement-breakpoint
ALTER TABLE `users` ADD `avatar_media_id` integer REFERENCES media(id) ON DELETE set null;--> statement-breakpoint
-- Backfill author slugs: slugify-lite of `name` (lower + spaces/underscores to
-- hyphens, empty becomes `user`), duplicates numbered -2, -3, ... by row order.
UPDATE `users` SET `slug` = (
  SELECT slugged FROM (
    SELECT id,
      base || CASE WHEN rn > 1 THEN '-' || rn ELSE '' END AS slugged
    FROM (
      SELECT id,
        ROW_NUMBER() OVER (PARTITION BY base ORDER BY id) AS rn,
        base
      FROM (
        SELECT id,
          COALESCE(
            NULLIF(TRIM(LOWER(REPLACE(REPLACE(`name`, ' ', '-'), '_', '-')), '-'), ''),
            'user'
          ) AS base
        FROM `users`
      )
    )
  ) s WHERE s.id = `users`.id
);--> statement-breakpoint
CREATE UNIQUE INDEX `users_slug_uq` ON `users` (`slug`);
