-- Authoritative worksheet context and detailed line-level classification audit.

CREATE TABLE IF NOT EXISTS classification_worksheets (
  invoice_id TEXT PRIMARY KEY,
  tax_inputs_json TEXT NOT NULL DEFAULT '{}',
  item_exemptions_json TEXT NOT NULL DEFAULT '{}',
  exchange_rate REAL NOT NULL DEFAULT 6.75,
  totals_json TEXT NOT NULL DEFAULT '{}',
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS classification_line_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_id INTEGER NOT NULL REFERENCES classification_lines(line_id) ON DELETE CASCADE,
  recommendation_id INTEGER REFERENCES classification_recommendations(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  actor TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_classification_line_events_line
  ON classification_line_events(line_id, created_at DESC);
