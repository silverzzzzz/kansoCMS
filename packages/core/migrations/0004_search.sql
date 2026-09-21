ALTER TABLE `pages` ADD `search_text` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `posts` ADD `search_text` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE VIRTUAL TABLE `search_index` USING fts5(`kind` UNINDEXED, `ref_id` UNINDEXED, `title`, `excerpt`, `body`, tokenize='trigram');
--> statement-breakpoint
CREATE TRIGGER `pages_search_ai` AFTER INSERT ON `pages` BEGIN
  INSERT INTO `search_index`(`kind`, `ref_id`, `title`, `excerpt`, `body`) VALUES ('page', new.`id`, new.`title`, coalesce(new.`excerpt`, ''), new.`search_text`);
END;
--> statement-breakpoint
CREATE TRIGGER `pages_search_au` AFTER UPDATE OF `title`, `excerpt`, `search_text` ON `pages` BEGIN
  DELETE FROM `search_index` WHERE `kind` = 'page' AND `ref_id` = old.`id`;
  INSERT INTO `search_index`(`kind`, `ref_id`, `title`, `excerpt`, `body`) VALUES ('page', new.`id`, new.`title`, coalesce(new.`excerpt`, ''), new.`search_text`);
END;
--> statement-breakpoint
CREATE TRIGGER `pages_search_ad` AFTER DELETE ON `pages` BEGIN
  DELETE FROM `search_index` WHERE `kind` = 'page' AND `ref_id` = old.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `posts_search_ai` AFTER INSERT ON `posts` BEGIN
  INSERT INTO `search_index`(`kind`, `ref_id`, `title`, `excerpt`, `body`) VALUES ('post', new.`id`, new.`title`, coalesce(new.`excerpt`, ''), new.`search_text`);
END;
--> statement-breakpoint
CREATE TRIGGER `posts_search_au` AFTER UPDATE OF `title`, `excerpt`, `search_text` ON `posts` BEGIN
  DELETE FROM `search_index` WHERE `kind` = 'post' AND `ref_id` = old.`id`;
  INSERT INTO `search_index`(`kind`, `ref_id`, `title`, `excerpt`, `body`) VALUES ('post', new.`id`, new.`title`, coalesce(new.`excerpt`, ''), new.`search_text`);
END;
--> statement-breakpoint
CREATE TRIGGER `posts_search_ad` AFTER DELETE ON `posts` BEGIN
  DELETE FROM `search_index` WHERE `kind` = 'post' AND `ref_id` = old.`id`;
END;
--> statement-breakpoint
INSERT INTO `search_index`(`kind`, `ref_id`, `title`, `excerpt`, `body`) SELECT 'page', `id`, `title`, coalesce(`excerpt`, ''), '' FROM `pages`;
--> statement-breakpoint
INSERT INTO `search_index`(`kind`, `ref_id`, `title`, `excerpt`, `body`) SELECT 'post', `id`, `title`, coalesce(`excerpt`, ''), '' FROM `posts`;
