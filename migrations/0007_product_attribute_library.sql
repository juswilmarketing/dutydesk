-- Product Attribute Library (data-driven family attribute profiles)
CREATE TABLE IF NOT EXISTS product_attribute_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_family TEXT NOT NULL UNIQUE,
  industry TEXT NOT NULL,
  typical_chapters TEXT NOT NULL DEFAULT '[]',
  required_attributes TEXT NOT NULL DEFAULT '[]',
  optional_attributes TEXT NOT NULL DEFAULT '[]',
  question_order TEXT NOT NULL DEFAULT '[]',
  validation_rules TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attr_lib_industry ON product_attribute_library(industry);
CREATE INDEX IF NOT EXISTS idx_attr_lib_status ON product_attribute_library(status);

-- Learned attribute values reused across shipments
CREATE TABLE IF NOT EXISTS attribute_learning (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  learning_key TEXT NOT NULL UNIQUE,
  supplier_name TEXT,
  normalized_supplier TEXT,
  model_number TEXT,
  part_number TEXT,
  product_key TEXT,
  product_family TEXT,
  attribute_key TEXT NOT NULL,
  attribute_value TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  usage_count INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'clerk',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attr_learn_supplier ON attribute_learning(normalized_supplier);
CREATE INDEX IF NOT EXISTS idx_attr_learn_model ON attribute_learning(model_number);
CREATE INDEX IF NOT EXISTS idx_attr_learn_family ON attribute_learning(product_family);
CREATE INDEX IF NOT EXISTS idx_attr_learn_attr ON attribute_learning(attribute_key);

-- Analytics for questions / inference
CREATE TABLE IF NOT EXISTS attribute_analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  product_family TEXT,
  attribute_key TEXT,
  question_prompt TEXT,
  confidence REAL,
  meta_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attr_analytics_type ON attribute_analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_attr_analytics_family ON attribute_analytics_events(product_family);
CREATE INDEX IF NOT EXISTS idx_attr_analytics_attr ON attribute_analytics_events(attribute_key);
