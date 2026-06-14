-- 1. users 加 role 列
ALTER TABLE `users` ADD COLUMN `role` text DEFAULT 'user' NOT NULL;

-- 2. skills 加审核相关 5 列
ALTER TABLE `skills` ADD COLUMN `review_status` text DEFAULT 'pending' NOT NULL;
ALTER TABLE `skills` ADD COLUMN `reject_reason` text;
ALTER TABLE `skills` ADD COLUMN `version` integer DEFAULT 1 NOT NULL;
ALTER TABLE `skills` ADD COLUMN `reviewed_at` integer;
ALTER TABLE `skills` ADD COLUMN `reviewed_by` integer REFERENCES `users`(`id`);

-- 3. grandfather 现有 public skill 为 approved
UPDATE `skills` SET `review_status` = 'approved', `reviewed_at` = unixepoch()
WHERE `is_public` = 1;

-- 4. 索引：admin 查 pending 列表
CREATE INDEX `idx_skills_review_status` ON `skills` (`review_status`, `is_public`)
  WHERE `deleted_at` IS NULL;
