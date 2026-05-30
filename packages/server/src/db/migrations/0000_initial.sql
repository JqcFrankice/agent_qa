PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS `users` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `username` text NOT NULL,
  `password_hash` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `default_provider` text
);
CREATE UNIQUE INDEX IF NOT EXISTS `users_username_unique` ON `users` (`username`);

CREATE TABLE IF NOT EXISTS `sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` integer NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `last_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
  `expires_at` integer NOT NULL,
  `ip_address` text,
  `user_agent` text,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS `idx_sessions_user_id` ON `sessions` (`user_id`);
CREATE INDEX IF NOT EXISTS `idx_sessions_expires` ON `sessions` (`expires_at`);

CREATE TABLE IF NOT EXISTS `invite_codes` (
  `code` text PRIMARY KEY NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `expires_at` integer,
  `uses_remaining` integer DEFAULT 1 NOT NULL,
  `created_by` text NOT NULL,
  `note` text
);
