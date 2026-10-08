-- One in-progress clerk job per user; closed when sent or abandoned.

CREATE TABLE IF NOT EXISTS duty_jobs (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'abandoned')),
  job_type TEXT CHECK (job_type IS NULL OR job_type IN ('classification_only', 'brokerage_clearance')),
  worksheet_num TEXT,
  consignee_id TEXT,
  state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_duty_jobs_one_draft_per_user
  ON duty_jobs(user_id) WHERE status = 'draft';

CREATE INDEX IF NOT EXISTS idx_duty_jobs_user_status
  ON duty_jobs(user_id, status, updated_at DESC);
