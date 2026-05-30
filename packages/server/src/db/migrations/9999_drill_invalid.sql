-- DRILL: intentionally invalid migration to test deploy-agent migrate-abort path.
-- Expected: db:migrate fails, deploy-agent aborts before restart, old service keeps serving.
-- This will be reverted immediately after the drill.
CREATE TABLE drill_invalid (
  id integer PRIMARY KEY
) THIS IS NOT VALID SQL;
