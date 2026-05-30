CREATE TABLE `conversations` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` integer NOT NULL,
  `title` text,
  `provider` text NOT NULL,
  `model` text NOT NULL,
  `system_prompt` text,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  `deleted_at` integer,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `idx_conversations_user_updated` ON `conversations` (`user_id`,`updated_at`);
CREATE INDEX `idx_conversations_user_active` ON `conversations` (`user_id`,`deleted_at`);

CREATE TABLE `messages` (
  `id` text PRIMARY KEY NOT NULL,
  `conversation_id` text NOT NULL,
  `role` text NOT NULL,
  `content` text DEFAULT '' NOT NULL,
  `status` text DEFAULT 'complete' NOT NULL,
  `error_code` text,
  `provider_message_id` text,
  `input_tokens` integer,
  `output_tokens` integer,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `idx_messages_conv_created` ON `messages` (`conversation_id`,`created_at`);
