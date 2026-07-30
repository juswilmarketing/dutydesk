-- Evidence-Based Product Resolver and permanent Product Master.

CREATE TABLE IF NOT EXISTS product_master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_product_id INTEGER UNIQUE REFERENCES canonical_products(id) ON DELETE SET NULL,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  short_name TEXT,
  product_family TEXT,
  industry TEXT,
  primary_function TEXT,
  typical_materials_json TEXT NOT NULL DEFAULT '[]',
  typical_uses_json TEXT NOT NULL DEFAULT '[]',
  aliases_json TEXT NOT NULL DEFAULT '[]',
  brands_json TEXT NOT NULL DEFAULT '[]',
  manufacturers_json TEXT NOT NULL DEFAULT '[]',
  supplier_mappings_json TEXT NOT NULL DEFAULT '[]',
  product_codes_json TEXT NOT NULL DEFAULT '[]',
  approved_tariffs_json TEXT NOT NULL DEFAULT '[]',
  typical_chapters_json TEXT NOT NULL DEFAULT '[]',
  required_attributes_json TEXT NOT NULL DEFAULT '[]',
  optional_attributes_json TEXT NOT NULL DEFAULT '[]',
  created_from TEXT NOT NULL DEFAULT 'migration',
  approval_count INTEGER NOT NULL DEFAULT 0,
  supplier_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  supervisor_review_required INTEGER NOT NULL DEFAULT 0,
  last_approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_master_name ON product_master(normalized_name);
CREATE INDEX IF NOT EXISTS idx_product_master_family ON product_master(product_family);
CREATE INDEX IF NOT EXISTS idx_product_master_industry ON product_master(industry);

INSERT OR IGNORE INTO product_master
  (canonical_product_id, canonical_name, normalized_name, short_name, product_family, industry,
   primary_function, typical_materials_json, typical_uses_json, product_codes_json,
   approved_tariffs_json, typical_chapters_json, required_attributes_json, created_from,
   approval_count, supplier_count, last_approved_at)
SELECT
  cp.id,
  cp.canonical_name,
  cp.normalized_name,
  cp.canonical_name,
  cp.product_family,
  COALESCE(cp.industry_name, cp.industry_code),
  json_extract(cp.common_uses_json, '$[0]'),
  cp.typical_materials_json,
  cp.common_uses_json,
  '[]',
  CASE WHEN cp.approved_tariff IS NULL THEN '[]' ELSE json_array(cp.approved_tariff) END,
  cp.typical_chapters_json,
  cp.typical_attributes_json,
  'canonical_products',
  cp.approval_count,
  (SELECT COUNT(DISTINCT spm.normalized_supplier)
   FROM supplier_product_mappings spm WHERE spm.canonical_product_id = cp.id),
  CASE WHEN cp.approval_count > 0 THEN cp.updated_at ELSE NULL END
FROM canonical_products cp
WHERE cp.status = 'active';

ALTER TABLE product_aliases ADD COLUMN product_master_id INTEGER REFERENCES product_master(id);
ALTER TABLE product_aliases ADD COLUMN supplier_id TEXT;
ALTER TABLE product_aliases ADD COLUMN brand_id INTEGER;
ALTER TABLE product_aliases ADD COLUMN created_by TEXT;
UPDATE product_aliases
SET product_master_id = (
  SELECT pm.id FROM product_master pm
  WHERE pm.canonical_product_id = product_aliases.canonical_product_id
);
CREATE INDEX IF NOT EXISTS idx_product_alias_master ON product_aliases(product_master_id);

CREATE TABLE IF NOT EXISTS supplier_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id TEXT,
  supplier_name TEXT NOT NULL,
  normalized_supplier TEXT NOT NULL,
  supplier_aliases_json TEXT NOT NULL DEFAULT '[]',
  product_code TEXT,
  normalized_product_code TEXT,
  supplier_sku TEXT,
  normalized_sku TEXT,
  supplier_description TEXT,
  normalized_description TEXT,
  product_master_id INTEGER NOT NULL REFERENCES product_master(id) ON DELETE RESTRICT,
  canonical_product_name TEXT NOT NULL,
  brand TEXT,
  manufacturer TEXT,
  material TEXT,
  primary_function TEXT,
  product_family TEXT,
  approved_tariff TEXT,
  approval_count INTEGER NOT NULL DEFAULT 0,
  original_descriptions_json TEXT NOT NULL DEFAULT '[]',
  clerk_aliases_json TEXT NOT NULL DEFAULT '[]',
  approved INTEGER NOT NULL DEFAULT 0,
  last_approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_products_code
  ON supplier_products(normalized_supplier, normalized_product_code)
  WHERE normalized_product_code IS NOT NULL AND normalized_product_code <> '';
CREATE INDEX IF NOT EXISTS idx_supplier_products_sku
  ON supplier_products(normalized_supplier, normalized_sku);
CREATE INDEX IF NOT EXISTS idx_supplier_products_master ON supplier_products(product_master_id);

INSERT OR IGNORE INTO supplier_products
  (supplier_id, supplier_name, normalized_supplier, product_code, normalized_product_code,
   supplier_sku, normalized_sku, supplier_description, normalized_description,
   product_master_id, canonical_product_name, brand, material, primary_function,
   product_family, approved_tariff, approval_count, original_descriptions_json,
   approved, last_approved_at)
SELECT
  spm.id,
  spm.supplier_name,
  spm.normalized_supplier,
  COALESCE(spm.supplier_sku, spm.normalized_sku),
  spm.normalized_sku,
  spm.supplier_sku,
  spm.normalized_sku,
  spm.supplier_description,
  spm.normalized_description,
  pm.id,
  pm.canonical_name,
  spm.brand,
  json_extract(pm.typical_materials_json, '$[0]'),
  pm.primary_function,
  pm.product_family,
  spm.approved_tariff,
  spm.approval_count,
  CASE WHEN spm.supplier_description IS NULL THEN '[]'
       ELSE json_array(spm.supplier_description) END,
  spm.approved,
  CASE WHEN spm.approved = 1 THEN spm.updated_at ELSE NULL END
FROM supplier_product_mappings spm
JOIN product_master pm ON pm.canonical_product_id = spm.canonical_product_id;

CREATE TABLE IF NOT EXISTS product_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_line_id TEXT,
  shipment_id TEXT,
  resolution_id INTEGER,
  product_master_id INTEGER REFERENCES product_master(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  matched_value TEXT,
  product_identity TEXT,
  supplier TEXT,
  product_code TEXT,
  brand TEXT,
  manufacturer TEXT,
  material TEXT,
  primary_function TEXT,
  approved_tariff TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  is_approved INTEGER NOT NULL DEFAULT 0,
  document_reference TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_evidence_line ON product_evidence(invoice_line_id);
CREATE INDEX IF NOT EXISTS idx_product_evidence_resolution ON product_evidence(resolution_id);
CREATE INDEX IF NOT EXISTS idx_product_evidence_code ON product_evidence(product_code);

CREATE TABLE IF NOT EXISTS product_resolution_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_line_id TEXT NOT NULL,
  shipment_id TEXT,
  supplier_name TEXT,
  raw_description TEXT NOT NULL,
  parsed_json TEXT NOT NULL,
  status TEXT NOT NULL,
  resolved_product_json TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  missing_information_json TEXT NOT NULL DEFAULT '[]',
  possible_matches_json TEXT NOT NULL DEFAULT '[]',
  related_product_group TEXT,
  confirmed INTEGER NOT NULL DEFAULT 0,
  confirmed_by TEXT,
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_resolution_results_line
  ON product_resolution_results(invoice_line_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resolution_results_shipment ON product_resolution_results(shipment_id);

CREATE TABLE IF NOT EXISTS classification_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_id INTEGER NOT NULL,
  recommendation_id INTEGER REFERENCES classification_recommendations(id) ON DELETE SET NULL,
  resolution_id INTEGER REFERENCES product_resolution_results(id) ON DELETE SET NULL,
  product_master_id INTEGER REFERENCES product_master(id) ON DELETE SET NULL,
  selected_tariff TEXT NOT NULL,
  source TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  approved_by TEXT,
  approved_at TEXT NOT NULL DEFAULT (datetime('now')),
  previous_value_json TEXT NOT NULL DEFAULT '{}',
  approved_value_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_classification_approvals_line
  ON classification_approvals(line_id, approved_at DESC);

ALTER TABLE classification_lines ADD COLUMN resolution_id INTEGER REFERENCES product_resolution_results(id);
ALTER TABLE classification_lines ADD COLUMN product_master_id INTEGER REFERENCES product_master(id);
ALTER TABLE classification_lines ADD COLUMN evidence_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE classification_recommendations ADD COLUMN resolution_id INTEGER REFERENCES product_resolution_results(id);
ALTER TABLE classification_recommendations ADD COLUMN evidence_ids_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS document_product_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id TEXT,
  document_id TEXT NOT NULL,
  job_id TEXT,
  page_number INTEGER,
  document_type TEXT,
  document_filename TEXT,
  product_code TEXT,
  normalized_product_code TEXT,
  product_master_id INTEGER REFERENCES product_master(id) ON DELETE SET NULL,
  extracted_product_name TEXT,
  brand TEXT,
  manufacturer TEXT,
  material TEXT,
  primary_function TEXT,
  excerpt TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_document_product_code
  ON document_product_references(normalized_product_code);
CREATE INDEX IF NOT EXISTS idx_document_product_shipment ON document_product_references(shipment_id);

CREATE TABLE IF NOT EXISTS abbreviation_meanings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  abbreviation TEXT NOT NULL,
  normalized_abbreviation TEXT NOT NULL,
  meaning TEXT NOT NULL,
  supplier_name TEXT,
  normalized_supplier TEXT,
  industry_code TEXT,
  surrounding_terms_json TEXT NOT NULL DEFAULT '[]',
  approved INTEGER NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(normalized_abbreviation, meaning, normalized_supplier, industry_code)
);

CREATE INDEX IF NOT EXISTS idx_abbreviation_meanings_key
  ON abbreviation_meanings(normalized_abbreviation);

INSERT OR IGNORE INTO abbreviation_meanings
  (abbreviation, normalized_abbreviation, meaning, surrounding_terms_json, approved, usage_count, created_by)
VALUES
  ('ASSY', 'ASSY', 'Assembly', '[]', 1, 0, 'seed'),
  ('WHT', 'WHT', 'White', '[]', 1, 0, 'seed'),
  ('BLK', 'BLK', 'Black', '[]', 1, 0, 'seed'),
  ('CBL', 'CBL', 'Cable', '[]', 1, 0, 'seed'),
  ('TWL', 'TWL', 'Towel', '[]', 1, 0, 'seed'),
  ('SHWR', 'SHWR', 'Shower', '["CAP"]', 1, 0, 'seed'),
  ('DISP', 'DISP', 'Disposable', '["CAP","GLOVE"]', 1, 0, 'seed'),
  ('SS', 'SS', 'Stainless Steel', '["PIPE","FITTING","BOLT","SCREW"]', 1, 0, 'seed'),
  ('ACT', 'ACT', 'Activator', '["ADHESIVE","RUBBER","PRIMER"]', 0, 0, 'seed'),
  ('SP', 'SP', 'Spare', '["PART"]', 0, 0, 'seed'),
  ('SP', 'SP', 'Shower', '["CAP"]', 0, 0, 'seed');

-- Flex-Lag example: resolvable by exact supplier + product code, without assigning a tariff.
INSERT OR IGNORE INTO product_master
  (canonical_name, normalized_name, short_name, product_family, industry, primary_function,
   typical_materials_json, typical_uses_json, aliases_json, brands_json, manufacturers_json,
   product_codes_json, approved_tariffs_json, typical_chapters_json, required_attributes_json,
   created_from, approval_count)
VALUES
  ('Rubber bonding activator for conveyor belt lagging',
   'rubber bonding activator for conveyor belt lagging',
   'Rubber Bonding Activator',
   'Industrial rubber bonding preparation',
   'Industrial Chemicals',
   'Preparing surfaces during conveyor belt lagging installation',
   '[]',
   '["rubber bonding","conveyor belt lagging installation"]',
   '["FLEXLAG ACTIVATOR","FL-ACT FLEXLAG ACTIVATOR"]',
   '["FLEX-LAG","FLEXLAG"]',
   '["FLEXCO"]',
   '["FL-ACT"]',
   '[]',
   '["35","38"]',
   '["material or composition","physical form","intended use"]',
   'acceptance_seed',
   0);

INSERT OR IGNORE INTO supplier_products
  (supplier_name, normalized_supplier, supplier_aliases_json, product_code,
   normalized_product_code, supplier_sku, normalized_sku, supplier_description,
   normalized_description, product_master_id, canonical_product_name, brand,
   manufacturer, primary_function, product_family, original_descriptions_json,
   approved, approval_count)
SELECT
  'Flexco',
  'flexco',
  '["Flexco Corporation"]',
  'FL-ACT',
  'FLACT',
  'FL-ACT',
  'FLACT',
  'FLEXLAG ACTIVATOR',
  'flexlag activator',
  id,
  canonical_name,
  'Flex-Lag',
  'Flexco',
  primary_function,
  product_family,
  '["FL-ACT FLEXLAG ACTIVATOR"]',
  1,
  1
FROM product_master
WHERE normalized_name = 'rubber bonding activator for conveyor belt lagging';
