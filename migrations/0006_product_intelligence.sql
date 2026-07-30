CREATE TABLE IF NOT EXISTS industry_dictionary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  typical_chapters TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_dictionary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_name TEXT NOT NULL,
  normalized_key TEXT NOT NULL UNIQUE,
  synonyms TEXT NOT NULL DEFAULT '[]',
  product_family TEXT NOT NULL,
  industry_code TEXT NOT NULL,
  typical_chapter TEXT,
  common_materials TEXT NOT NULL DEFAULT '[]',
  typical_uses TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_dict_industry ON product_dictionary(industry_code);
CREATE INDEX IF NOT EXISTS idx_product_dict_family ON product_dictionary(product_family);
CREATE INDEX IF NOT EXISTS idx_product_dict_chapter ON product_dictionary(typical_chapter);

CREATE TABLE IF NOT EXISTS brand_dictionary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,
  normalized_brand TEXT NOT NULL UNIQUE,
  industry_hints TEXT NOT NULL DEFAULT '[]',
  typical_chapters TEXT NOT NULL DEFAULT '[]',
  confidence_boost REAL NOT NULL DEFAULT 0.05,
  status TEXT NOT NULL DEFAULT 'active',
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS question_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  industry_code TEXT,
  product_family TEXT,
  questions_json TEXT NOT NULL DEFAULT '[]',
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_question_rules_industry ON question_rules(industry_code);
CREATE INDEX IF NOT EXISTS idx_question_rules_family ON question_rules(product_family);

CREATE TABLE IF NOT EXISTS chapter_prediction_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  industry_code TEXT,
  product_family TEXT,
  material TEXT,
  function_key TEXT,
  chapter TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chapter_rules_industry ON chapter_prediction_rules(industry_code);
CREATE INDEX IF NOT EXISTS idx_chapter_rules_family ON chapter_prediction_rules(product_family);

CREATE TABLE IF NOT EXISTS product_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_key TEXT,
  invoice_id TEXT,
  supplier_name TEXT,
  original_description TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  predictions_json TEXT,
  questions_json TEXT,
  answers_json TEXT,
  explainability_json TEXT,
  selected_hs_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_profiles_supplier ON product_profiles(supplier_name);
CREATE INDEX IF NOT EXISTS idx_product_profiles_hs ON product_profiles(selected_hs_code);

CREATE TABLE IF NOT EXISTS product_learning_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER REFERENCES product_profiles(id) ON DELETE SET NULL,
  original_description TEXT NOT NULL,
  normalized_name TEXT,
  industry_code TEXT,
  product_family TEXT,
  predicted_chapter TEXT,
  predicted_heading TEXT,
  selected_hs_code TEXT NOT NULL,
  duty_rate TEXT,
  questions_json TEXT,
  answers_json TEXT,
  predictions_json TEXT,
  explainability_json TEXT,
  clerk_username TEXT,
  supplier_name TEXT,
  brand TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_learning_industry ON product_learning_events(industry_code);
CREATE INDEX IF NOT EXISTS idx_learning_chapter ON product_learning_events(predicted_chapter);
CREATE INDEX IF NOT EXISTS idx_learning_hs ON product_learning_events(selected_hs_code);
