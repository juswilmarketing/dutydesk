-- Liquid Composition & Mixture Intelligence
CREATE TABLE IF NOT EXISTS liquid_composition_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  liquid_type TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  typical_chapters TEXT NOT NULL DEFAULT '[]',
  required_fields TEXT NOT NULL DEFAULT '[]',
  composition_thresholds TEXT NOT NULL DEFAULT '[]',
  active_ingredient_mappings TEXT NOT NULL DEFAULT '[]',
  solvent_base_mappings TEXT NOT NULL DEFAULT '[]',
  chemical_synonyms TEXT NOT NULL DEFAULT '[]',
  cas_mappings TEXT NOT NULL DEFAULT '[]',
  classification_hints TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_liq_rules_status ON liquid_composition_rules(status);

CREATE TABLE IF NOT EXISTS liquid_product_compositions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identity_key TEXT NOT NULL UNIQUE,
  supplier_name TEXT,
  brand TEXT,
  product_name TEXT,
  model_number TEXT,
  part_number TEXT,
  manufacturer TEXT,
  liquid_profile_json TEXT NOT NULL,
  composition_json TEXT NOT NULL DEFAULT '[]',
  essential_character_component TEXT,
  essential_character_reason TEXT,
  approved BOOLEAN NOT NULL DEFAULT 0,
  approved_by TEXT,
  usage_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_liq_comp_supplier ON liquid_product_compositions(supplier_name);
CREATE INDEX IF NOT EXISTS idx_liq_comp_product ON liquid_product_compositions(product_name);
CREATE INDEX IF NOT EXISTS idx_liq_comp_model ON liquid_product_compositions(model_number);
CREATE INDEX IF NOT EXISTS idx_liq_comp_approved ON liquid_product_compositions(approved);

CREATE TABLE IF NOT EXISTS liquid_composition_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identity_key TEXT,
  conflict_type TEXT NOT NULL,
  description TEXT NOT NULL,
  left_source TEXT,
  right_source TEXT,
  left_json TEXT,
  right_json TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolved_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_liq_conflict_status ON liquid_composition_conflicts(status);
CREATE INDEX IF NOT EXISTS idx_liq_conflict_type ON liquid_composition_conflicts(conflict_type);
