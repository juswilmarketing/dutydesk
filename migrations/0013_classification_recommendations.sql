-- Durable recommendation/apply workflow for invoice classification lines.

CREATE TABLE IF NOT EXISTS classification_lines (
  line_id INTEGER PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  original_description TEXT NOT NULL,
  identified_item TEXT,
  material TEXT,
  product_family TEXT,
  primary_use TEXT,
  brand TEXT,
  model_sku TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  tariff_code TEXT,
  tariff_description TEXT,
  duty_rate REAL NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL DEFAULT 12.5,
  levy_rate REAL NOT NULL DEFAULT 0,
  classification_status TEXT NOT NULL DEFAULT 'Product Detected',
  recommendation_source TEXT,
  product_profile_json TEXT NOT NULL DEFAULT '{}',
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_classification_lines_invoice ON classification_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_classification_lines_status ON classification_lines(classification_status);

CREATE TABLE IF NOT EXISTS classification_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_id INTEGER NOT NULL REFERENCES classification_lines(line_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  recommended_candidate_json TEXT,
  alternatives_json TEXT NOT NULL DEFAULT '[]',
  product_profile_json TEXT NOT NULL DEFAULT '{}',
  generated_by TEXT,
  applied_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_classification_recommendations_line
  ON classification_recommendations(line_id, created_at DESC);
