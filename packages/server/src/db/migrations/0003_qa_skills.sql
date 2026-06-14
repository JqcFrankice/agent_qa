-- 1. system 占位作者（不可登录）
INSERT OR IGNORE INTO users (username, password_hash, default_provider)
VALUES ('system', '!disabled', NULL);

-- 2. skills 加 3 列（forward-only）
ALTER TABLE `skills` ADD COLUMN `input_schema` text;
ALTER TABLE `skills` ADD COLUMN `tags` text DEFAULT '[]' NOT NULL;
ALTER TABLE `skills` ADD COLUMN `slug` text;

-- 3. slug 唯一索引（仅 NOT NULL 行参与去重）
CREATE UNIQUE INDEX `idx_skills_slug` ON `skills` (`slug`) WHERE `slug` IS NOT NULL;
