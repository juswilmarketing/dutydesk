-- Product-first resolver: canonical products, aliases, supplier memory and audit.

CREATE TABLE IF NOT EXISTS canonical_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  industry_code TEXT,
  industry_name TEXT,
  product_family TEXT,
  typical_materials_json TEXT NOT NULL DEFAULT '[]',
  typical_chapters_json TEXT NOT NULL DEFAULT '[]',
  common_uses_json TEXT NOT NULL DEFAULT '[]',
  typical_attributes_json TEXT NOT NULL DEFAULT '[]',
  approved_tariff TEXT,
  image_url TEXT,
  approval_count INTEGER NOT NULL DEFAULT 0,
  correction_count INTEGER NOT NULL DEFAULT 0,
  import_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_canonical_products_name ON canonical_products(normalized_name);
CREATE INDEX IF NOT EXISTS idx_canonical_products_family ON canonical_products(product_family);
CREATE INDEX IF NOT EXISTS idx_canonical_products_industry ON canonical_products(industry_code);

CREATE TABLE IF NOT EXISTS product_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_product_id INTEGER NOT NULL REFERENCES canonical_products(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL UNIQUE,
  compact_alias TEXT NOT NULL,
  phonetic_key TEXT,
  source TEXT NOT NULL DEFAULT 'seed',
  supplier_name TEXT,
  approved INTEGER NOT NULL DEFAULT 1,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_alias_canonical ON product_aliases(canonical_product_id);
CREATE INDEX IF NOT EXISTS idx_product_alias_compact ON product_aliases(compact_alias);
CREATE INDEX IF NOT EXISTS idx_product_alias_phonetic ON product_aliases(phonetic_key);

CREATE TABLE IF NOT EXISTS supplier_product_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_product_id INTEGER NOT NULL REFERENCES canonical_products(id) ON DELETE CASCADE,
  supplier_name TEXT NOT NULL,
  normalized_supplier TEXT NOT NULL,
  supplier_sku TEXT,
  normalized_sku TEXT,
  supplier_description TEXT,
  normalized_description TEXT,
  brand TEXT,
  approved_tariff TEXT,
  approved INTEGER NOT NULL DEFAULT 1,
  approval_count INTEGER NOT NULL DEFAULT 1,
  import_count INTEGER NOT NULL DEFAULT 1,
  last_imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_supplier_product_supplier ON supplier_product_mappings(normalized_supplier);
CREATE INDEX IF NOT EXISTS idx_supplier_product_sku ON supplier_product_mappings(normalized_supplier, normalized_sku);
CREATE INDEX IF NOT EXISTS idx_supplier_product_canonical ON supplier_product_mappings(canonical_product_id);

CREATE TABLE IF NOT EXISTS product_resolver_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  original_description TEXT,
  normalized_query TEXT,
  supplier_name TEXT,
  canonical_product_id INTEGER REFERENCES canonical_products(id) ON DELETE SET NULL,
  selected_name TEXT,
  confidence REAL,
  source TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  clerk_username TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_resolver_events_type ON product_resolver_events(event_type);
CREATE INDEX IF NOT EXISTS idx_resolver_events_product ON product_resolver_events(canonical_product_id);
CREATE INDEX IF NOT EXISTS idx_resolver_events_created ON product_resolver_events(created_at);

-- Promote the existing product dictionary into the canonical product index.
INSERT OR IGNORE INTO canonical_products
  (canonical_name, normalized_name, industry_code, product_family, typical_materials_json,
   typical_chapters_json, common_uses_json, typical_attributes_json, approval_count, import_count)
SELECT
  canonical_name,
  normalized_key,
  industry_code,
  product_family,
  common_materials,
  CASE WHEN typical_chapter IS NULL OR typical_chapter = '' THEN '[]'
       ELSE '["' || typical_chapter || '"]' END,
  typical_uses,
  '[]',
  CASE WHEN usage_count > 0 THEN 1 ELSE 0 END,
  usage_count
FROM product_dictionary
WHERE status = 'active';

-- Canonical resolver examples and useful customs-broker vocabulary.
INSERT OR IGNORE INTO canonical_products
  (canonical_name, normalized_name, industry_code, industry_name, product_family,
   typical_materials_json, typical_chapters_json, common_uses_json, typical_attributes_json)
VALUES
  ('Bath Towels', 'bath towels', 'textiles', 'Textiles', 'Household Textile',
   '["cotton","microfibre","polyester","mixed"]', '["63"]',
   '["bath","hotel","household","retail","commercial"]',
   '["material","weight","dimensions","finished edge"]'),
  ('Hand Towels', 'hand towels', 'textiles', 'Textiles', 'Household Textile',
   '["cotton","microfibre","polyester"]', '["63"]',
   '["bathroom","hotel","household"]', '["material","weight","dimensions"]'),
  ('Face Towels', 'face towels', 'textiles', 'Textiles', 'Household Textile',
   '["cotton","microfibre"]', '["63"]', '["bathroom","hotel","household"]',
   '["material","weight","dimensions"]'),
  ('Kitchen Towels', 'kitchen towels', 'textiles', 'Textiles', 'Household Textile',
   '["cotton","microfibre"]', '["63"]', '["kitchen","household"]',
   '["material","weight","dimensions"]'),
  ('Beach Towels', 'beach towels', 'textiles', 'Textiles', 'Household Textile',
   '["cotton","microfibre"]', '["63"]', '["beach","leisure"]',
   '["material","weight","dimensions"]'),
  ('Bath Mats', 'bath mats', 'textiles', 'Textiles', 'Bathroom Furnishing',
   '["cotton","microfibre","rubber"]', '["57","63"]', '["bathroom","household"]',
   '["material","backing","dimensions"]'),
  ('Bath Robes', 'bath robes', 'textiles', 'Textiles', 'Apparel',
   '["cotton","polyester"]', '["61","62"]', '["bath","hotel","household"]',
   '["material","knitted or woven","size"]'),
  ('Shower Caps', 'shower caps', 'personal_care', 'Personal Care', 'Disposable Personal Articles',
   '["plastic"]', '["39","65"]', '["personal care","retail","medical"]',
   '["disposable","material","retail or medical"]'),
  ('Shower Curtains', 'shower curtains', 'household', 'Household', 'Bathroom Furnishing',
   '["plastic","textile"]', '["39","63"]', '["bathroom","household"]',
   '["material","dimensions"]'),
  ('Shower Hoses', 'shower hoses', 'hardware', 'Hardware', 'Plumbing Fitting',
   '["plastic","steel"]', '["39","73","83"]', '["bathroom","plumbing"]',
   '["material","length","fittings"]'),
  ('Shower Heads', 'shower heads', 'hardware', 'Hardware', 'Plumbing Fitting',
   '["plastic","steel","brass"]', '["39","74","84"]', '["bathroom","plumbing"]',
   '["material","spray type"]'),
  ('LED Power Supply', 'led power supply', 'electrical', 'Electrical', 'Electrical Appliance',
   '[]', '["85"]', '["lighting","electrical"]',
   '["input voltage","output voltage","wattage"]'),
  ('LED Strip', 'led strip', 'electrical', 'Electrical', 'Lighting',
   '["plastic","copper"]', '["85","94"]', '["lighting"]',
   '["voltage","wattage","length"]'),
  ('LED Bulb', 'led bulb', 'electrical', 'Electrical', 'Lighting',
   '["glass","plastic"]', '["85"]', '["lighting"]',
   '["voltage","wattage","base"]'),
  ('Metal Polish', 'metal polish', 'chemicals', 'Chemicals', 'Cleaning and Polishing Preparations',
   '[]', '["34"]', '["clean","polish","restore","maintenance"]',
   '["physical form","composition","intended surface"]'),
  ('Metal Cleaner', 'metal cleaner', 'chemicals', 'Chemicals', 'Cleaning Preparations',
   '[]', '["34","38"]', '["clean","degrease","maintenance"]',
   '["physical form","composition","intended surface"]'),
  ('Metal Restorer', 'metal restorer', 'chemicals', 'Chemicals', 'Cleaning and Polishing Preparations',
   '[]', '["34"]', '["restore","polish","maintenance"]',
   '["physical form","composition","intended surface"]'),
  ('Metal Polish Paste', 'metal polish paste', 'chemicals', 'Chemicals', 'Cleaning and Polishing Preparations',
   '[]', '["34"]', '["restore","polish","maintenance"]',
   '["composition","intended surface"]');

-- Explicit aliases. Each normalized alias belongs to one canonical product.
INSERT OR IGNORE INTO product_aliases
  (canonical_product_id, alias, normalized_alias, compact_alias, phonetic_key, source)
SELECT id, 'Bath Towel', 'bath towel', 'bathtowel', 'B330', 'seed'
FROM canonical_products WHERE normalized_name = 'bath towels';
INSERT OR IGNORE INTO product_aliases
SELECT NULL, id, 'B Towels', 'b towels', 'btowels', 'B342', 'seed', NULL, 1, 0, datetime('now'), datetime('now')
FROM canonical_products WHERE normalized_name = 'bath towels';
INSERT OR IGNORE INTO product_aliases
SELECT NULL, id, 'BTowels', 'btowels', 'btowels', 'B342', 'seed', NULL, 1, 0, datetime('now'), datetime('now')
FROM canonical_products WHERE normalized_name = 'bath towels';
INSERT OR IGNORE INTO product_aliases
SELECT NULL, id, 'Bath Twl', 'bath twl', 'bathtwl', 'B330', 'seed', NULL, 1, 0, datetime('now'), datetime('now')
FROM canonical_products WHERE normalized_name = 'bath towels';
INSERT OR IGNORE INTO product_aliases
SELECT NULL, id, 'Bath Linen', 'bath linen', 'bathlinen', 'B345', 'seed', NULL, 1, 0, datetime('now'), datetime('now')
FROM canonical_products WHERE normalized_name = 'bath towels';
INSERT OR IGNORE INTO product_aliases
SELECT NULL, id, 'Bath Sheet', 'bath sheet', 'bathsheet', 'B323', 'seed', NULL, 1, 0, datetime('now'), datetime('now')
FROM canonical_products WHERE normalized_name = 'bath towels';
INSERT OR IGNORE INTO product_aliases
SELECT NULL, id, 'Terry Towel', 'terry towel', 'terrytowel', 'T634', 'seed', NULL, 1, 0, datetime('now'), datetime('now')
FROM canonical_products WHERE normalized_name = 'bath towels';
INSERT OR IGNORE INTO product_aliases
SELECT NULL, id, 'Cotton Bath Towel', 'cotton bath towel', 'cottonbathtowel', 'C351', 'seed', NULL, 1, 0, datetime('now'), datetime('now')
FROM canonical_products WHERE normalized_name = 'bath towels';
INSERT OR IGNORE INTO product_aliases
SELECT NULL, id, 'Ladies Sandals', 'ladies sandals', 'ladiessandals', 'L322', 'seed', NULL, 1, 0, datetime('now'), datetime('now')
FROM canonical_products WHERE normalized_name IN ('sandals', 'women sandals') ORDER BY id LIMIT 1;
INSERT OR IGNORE INTO product_aliases
SELECT NULL, id, 'LED Driver', 'led driver', 'leddriver', 'L336', 'seed', NULL, 1, 0, datetime('now'), datetime('now')
FROM canonical_products WHERE normalized_name = 'led power supply';
INSERT OR IGNORE INTO product_aliases
SELECT NULL, id, '3M Metal Restorer', '3m metal restorer', '3mmetalrestorer', 'M345', 'seed', NULL, 1, 0, datetime('now'), datetime('now')
FROM canonical_products WHERE normalized_name = 'metal restorer';
INSERT OR IGNORE INTO product_aliases
SELECT NULL, id, 'Shower Cap', 'shower cap', 'showercap', 'S621', 'seed', NULL, 1, 0, datetime('now'), datetime('now')
FROM canonical_products WHERE normalized_name = 'shower caps';
