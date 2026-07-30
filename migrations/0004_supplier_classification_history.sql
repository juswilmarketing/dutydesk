-- Supplier classification history: per-supplier learned HS codes
CREATE TABLE IF NOT EXISTS supplier_classification_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_name TEXT NOT NULL,
  normalized_supplier_name TEXT NOT NULL,
  item_description TEXT NOT NULL,
  normalized_description TEXT NOT NULL,
  part_number TEXT,
  model_number TEXT,
  brand TEXT,
  hs_code TEXT NOT NULL,
  tariff_description TEXT,
  duty_rate TEXT NOT NULL,
  vat_rate TEXT DEFAULT '12.5%',
  confidence REAL DEFAULT 1.0,
  match_type TEXT NOT NULL DEFAULT 'supplier_exact',
  approved_by_clerk INTEGER NOT NULL DEFAULT 0,
  source_job_id TEXT,
  usage_count INTEGER NOT NULL DEFAULT 1,
  disabled INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_supplier_hist_norm_supplier
  ON supplier_classification_history (normalized_supplier_name);

CREATE INDEX IF NOT EXISTS idx_supplier_hist_norm_desc
  ON supplier_classification_history (normalized_supplier_name, normalized_description);

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_hist_unique
  ON supplier_classification_history (
    normalized_supplier_name,
    normalized_description,
    COALESCE(part_number, ''),
    COALESCE(model_number, '')
  );
