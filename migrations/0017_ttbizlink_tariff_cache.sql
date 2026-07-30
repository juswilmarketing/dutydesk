-- Local TTBizLink tariff snapshot and incremental official refresh state.

CREATE TABLE IF NOT EXISTS ttbizlink_tariffs (
  code TEXT PRIMARY KEY,
  normalized_code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  duty_rate TEXT NOT NULL,
  statistical_description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'bundled_snapshot',
  verified_at TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  lookup_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  last_error TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ttbiz_tariff_normalized
  ON ttbizlink_tariffs(normalized_code);
CREATE INDEX IF NOT EXISTS idx_ttbiz_tariff_refresh
  ON ttbizlink_tariffs(active, verified_at, updated_at);

CREATE TABLE IF NOT EXISTS ttbizlink_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL,
  requested_by TEXT,
  rows_attempted INTEGER NOT NULL DEFAULT 0,
  rows_verified INTEGER NOT NULL DEFAULT 0,
  rows_failed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
