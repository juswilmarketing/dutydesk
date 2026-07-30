-- DutyDesk workflow: shared consignees and tax advice log

CREATE TABLE IF NOT EXISTS consignees (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tax_log (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  sent_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_tax_log_sent_at ON tax_log(sent_at DESC);
