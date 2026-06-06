CREATE TABLE `skills` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `author_user_id` integer NOT NULL,
  `title` text NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `system_prompt` text NOT NULL,
  `default_provider` text,
  `default_model` text,
  `is_public` integer DEFAULT 0 NOT NULL,
  `published_at` integer,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  `deleted_at` integer,
  FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `idx_skills_author_active` ON `skills` (`author_user_id`,`deleted_at`);
CREATE INDEX `idx_skills_public_published` ON `skills` (`is_public`,`published_at`);

ALTER TABLE `conversations` ADD COLUMN `skill_id` integer REFERENCES `skills`(`id`);
CREATE INDEX `idx_conversations_skill` ON `conversations` (`skill_id`);
