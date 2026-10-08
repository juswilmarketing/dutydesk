-- Supplier product search cache + lightweight supplier profiles.
-- Used for token-efficient SKU/catalogue resolution before tariff ranking.

CREATE TABLE IF NOT EXISTS supplier_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_name TEXT NOT NULL,
  normalized_supplier TEXT NOT NULL UNIQUE,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  official_domain TEXT,
  primary_industries_json TEXT NOT NULL DEFAULT '[]',
  known_sku_patterns_json TEXT NOT NULL DEFAULT '[]',
  last_search_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS supplier_product_evidence_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_name TEXT NOT NULL,
  normalized_supplier TEXT NOT NULL,
  supplier_sku TEXT,
  normalized_sku TEXT,
  raw_description TEXT,
  normalized_description TEXT,
  canonical_product TEXT NOT NULL,
  material TEXT,
  primary_function TEXT,
  intended_use TEXT,
  technical_specifications_json TEXT NOT NULL DEFAULT '{}',
  empty_or_filled TEXT,
  approved_tariff TEXT,
  source_url TEXT,
  source_type TEXT NOT NULL DEFAULT 'pas_record',
  evidence_confidence REAL NOT NULL DEFAULT 0.8,
  excerpt TEXT,
  clerk_username TEXT,
  approved INTEGER NOT NULL DEFAULT 0,
  approved_at TEXT,
  retrieved_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_evidence_sku
  ON supplier_product_evidence_cache(normalized_supplier, normalized_sku)
  WHERE normalized_sku IS NOT NULL AND normalized_sku <> '';

CREATE INDEX IF NOT EXISTS idx_supplier_evidence_desc
  ON supplier_product_evidence_cache(normalized_supplier, normalized_description);

INSERT OR IGNORE INTO supplier_profiles
  (supplier_name, normalized_supplier, aliases_json, official_domain, primary_industries_json, known_sku_patterns_json)
VALUES
  (
    'K.G. International, Inc.',
    'k g international inc',
    '["kg international","k.g. international","kgint"]',
    'kgint.com',
    '["packaging","glass containers","plastic containers"]',
    '["^\\\\d{5,7}$"]'
  );
