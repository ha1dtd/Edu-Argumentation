-- ROLLBACK of migration 008_review_log_time.sql (edu_study v8 -> v7). MANUAL ONLY — never run by a deploy.
--
-- ⚠ This file lives in migrations/rollback/ and is named *.down.sql on purpose: db.migration_files()
--   globs migrations/*.sql (not recursive) and only runs names matching NNN_name.sql, so the runner
--   can never pick this up as a migration.
-- ⛔ DESTRUCTIVE: drops every review_log row (the grade history since v8) and the duration_ms of every
--   answer. answer_log rows themselves stay; review_cards (the schedule) is untouched. Roll the CODE back
--   first (deploy-study.sh --rollback): the v8 code writes these objects, the v7 code never reads them.
--   Take a pg_dump first:
--     pg_dump -Fc edu_study > ~/foxai-snapshots/edu_study-$(date +%Y%m%d-%H%M).dump
-- Run in ONE transaction:  psql edu_study -v ON_ERROR_STOP=1 -1 -f 008_review_log_time.down.sql
DROP TABLE IF EXISTS review_log;
ALTER TABLE answer_log DROP COLUMN IF EXISTS duration_ms;
DELETE FROM schema_migrations WHERE version = 8;
