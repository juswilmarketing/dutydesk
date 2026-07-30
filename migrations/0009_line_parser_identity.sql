-- Step 19: Complex Invoice Line Parser & Product Identity Resolver

CREATE TABLE IF NOT EXISTS abbreviation_dictionary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  abbreviation TEXT NOT NULL,
  meaning TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  industry_code TEXT,
  supplier_name TEXT,
  normalized_supplier TEXT,
  confidence REAL NOT NULL DEFAULT 0.8,
  verified INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_abbr_abbrev ON abbreviation_dictionary(abbreviation);
CREATE INDEX IF NOT EXISTS idx_abbr_supplier ON abbreviation_dictionary(normalized_supplier);
CREATE INDEX IF NOT EXISTS idx_abbr_status ON abbreviation_dictionary(status);

CREATE TABLE IF NOT EXISTS supplier_product_catalogue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id TEXT,
  supplier_name TEXT NOT NULL,
  normalized_supplier TEXT NOT NULL,
  brand TEXT,
  supplier_sku TEXT,
  normalized_sku TEXT,
  base_part_number TEXT,
  manufacturer_part_number TEXT,
  product_name TEXT,
  product_type TEXT,
  full_description TEXT,
  material TEXT,
  composition TEXT,
  function_use TEXT,
  specifications_json TEXT DEFAULT '{}',
  image_urls_json TEXT DEFAULT '[]',
  approved_hs_code TEXT,
  duty_rate TEXT,
  approval_status TEXT NOT NULL DEFAULT 'pending',
  source_document TEXT,
  last_verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cat_supplier ON supplier_product_catalogue(normalized_supplier);
CREATE INDEX IF NOT EXISTS idx_cat_sku ON supplier_product_catalogue(normalized_sku);
CREATE INDEX IF NOT EXISTS idx_cat_base ON supplier_product_catalogue(base_part_number);
CREATE INDEX IF NOT EXISTS idx_cat_mpn ON supplier_product_catalogue(manufacturer_part_number);
CREATE INDEX IF NOT EXISTS idx_cat_status ON supplier_product_catalogue(status);
CREATE INDEX IF NOT EXISTS idx_cat_approval ON supplier_product_catalogue(approval_status);

CREATE TABLE IF NOT EXISTS product_identity_learning (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identity_key TEXT NOT NULL UNIQUE,
  supplier_name TEXT,
  brand TEXT,
  base_part_number TEXT,
  full_sku TEXT,
  product_family TEXT,
  product_type TEXT,
  material TEXT,
  function_use TEXT,
  specifications_json TEXT DEFAULT '{}',
  approved_hs_code TEXT,
  duty_rate TEXT,
  approved INTEGER NOT NULL DEFAULT 1,
  usage_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pil_supplier ON product_identity_learning(supplier_name);
CREATE INDEX IF NOT EXISTS idx_pil_sku ON product_identity_learning(full_sku);
CREATE INDEX IF NOT EXISTS idx_pil_base ON product_identity_learning(base_part_number);
CREATE INDEX IF NOT EXISTS idx_pil_approved ON product_identity_learning(approved);
