-- edu_study schema, version 8 (23-11-26): Account page redesign B + C (plan account-redesign_23-11-26).
--
-- B  review_log        one row per review grade that was APPLIED (again / hard / good / easy), with the
--                      confidence he tapped before the options showed and what the schedule became. History
--                      for retention curves and "which grade do I press"; review_cards only holds the
--                      CURRENT state. A resent grade that review_grade skips as a duplicate is not logged
--                      twice; UNIQUE (account, book, question, reviewed_at) is the second guard.
-- C  answer_log.duration_ms   the time (ms) the question was on screen before it was answered, tab-hidden
--                      time excluded and capped at 5 minutes by the client; NULL for every answer logged
--                      before this version and for exam answers (the exam is timed by the server).
--
-- ⛔ Idempotent: CREATE TABLE / INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS; the runner also records
--    version 8 and never re-runs it.
-- ⛔ Additive only — one NEW table and one nullable column; no existing row changes; tables of the
--    edu_study database only. admin.py migrate takes a pg_dump first.
--    Rollback: migrations/rollback/008_review_log_time.down.sql (manual, never run by a deploy).
CREATE TABLE IF NOT EXISTS review_log (
    id              BIGSERIAL PRIMARY KEY,
    account_id      BIGINT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    module_id       TEXT NOT NULL,
    question_key    TEXT NOT NULL CHECK (char_length(question_key) BETWEEN 3 AND 64),
    grade           TEXT NOT NULL CHECK (grade IN ('again', 'hard', 'good', 'easy')),
    confidence      TEXT CHECK (confidence IN ('sure', 'unsure', 'guess')),
    chapter         INTEGER CHECK (chapter BETWEEN 0 AND 999),
    interval_before REAL CHECK (interval_before >= 0),
    interval_after  REAL NOT NULL CHECK (interval_after >= 0),
    ease_after      REAL NOT NULL,
    lapses_after    INTEGER NOT NULL CHECK (lapses_after >= 0),
    reviewed_at     TIMESTAMPTZ NOT NULL,
    UNIQUE (account_id, module_id, question_key, reviewed_at)
);
CREATE INDEX IF NOT EXISTS review_log_recent ON review_log (account_id, module_id, reviewed_at);

ALTER TABLE answer_log ADD COLUMN IF NOT EXISTS duration_ms INTEGER CHECK (duration_ms BETWEEN 0 AND 3600000);
