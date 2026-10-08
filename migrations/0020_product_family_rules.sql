-- Configurable product-family rules for common goods (admin-editable).
-- Built-in COMMON_PRODUCT_DICTIONARY remains the default; DB rows can extend/override by priority.

CREATE TABLE IF NOT EXISTS product_family_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_product TEXT NOT NULL,
  alias TEXT NOT NULL,
  product_family TEXT NOT NULL,
  likely_chapters TEXT NOT NULL DEFAULT '[]',
  likely_headings TEXT NOT NULL DEFAULT '[]',
  required_attributes TEXT NOT NULL DEFAULT '[]',
  prohibited_chapters TEXT NOT NULL DEFAULT '[]',
  priority INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_family_rules_alias
  ON product_family_rules(alias);
CREATE INDEX IF NOT EXISTS idx_product_family_rules_family
  ON product_family_rules(product_family);
CREATE INDEX IF NOT EXISTS idx_product_family_rules_active_priority
  ON product_family_rules(active, priority);

-- Seed high-priority appliance aliases (mirrors built-in dictionary; safe to re-run via INSERT OR IGNORE pattern)
INSERT INTO product_family_rules (
  canonical_product, alias, product_family, likely_chapters, likely_headings,
  required_attributes, prohibited_chapters, priority, active
) VALUES
  ('refrigerator', 'refrigerator', 'refrigeration equipment', '["84"]', '["8418"]', '[]', '["01","02","03","04","20","21","39","63","87","94"]', 10, 1),
  ('refrigerator', 'fridge', 'refrigeration equipment', '["84"]', '["8418"]', '[]', '["01","02","03","04","20","21","39","63","87","94"]', 10, 1),
  ('freezer', 'freezer', 'refrigeration equipment', '["84"]', '["8418"]', '[]', '["01","02","03","04","20","21","39","63","87","94"]', 10, 1),
  ('chest freezer', 'chest freezer', 'refrigeration equipment', '["84"]', '["8418"]', '[]', '["01","02","03","04","20","21","39","63","87","94"]', 5, 1),
  ('air conditioner', 'air conditioner', 'air conditioning equipment', '["84"]', '["8415"]', '[]', '["20","21","39","63","87","94"]', 10, 1),
  ('stove', 'stove', 'cooking appliance', '["85","73"]', '["8516","7321"]', '["energy source"]', '["20","21","63","87","94"]', 20, 1),
  ('stove', 'cooker', 'cooking appliance', '["85","73"]', '["8516","7321"]', '["energy source"]', '["20","21","63","87","94"]', 20, 1),
  ('microwave oven', 'microwave', 'microwave cooking appliance', '["85"]', '["8516"]', '[]', '["20","21","73","84","94"]', 10, 1),
  ('washing machine', 'washing machine', 'laundry equipment', '["84"]', '["8450"]', '[]', '["20","21","39","63","87","94"]', 10, 1),
  ('clothes dryer', 'dryer', 'laundry equipment', '["84"]', '["8451"]', '[]', '["20","21","39","63","87","94"]', 30, 1),
  ('television', 'television', 'television equipment', '["85"]', '["8528"]', '[]', '["20","21","73","84","94"]', 10, 1),
  ('television', 'smart tv', 'television equipment', '["85"]', '["8528"]', '[]', '["20","21","73","84","94"]', 10, 1),
  ('dishwasher', 'dishwasher', 'dishwashing equipment', '["84"]', '["8422"]', '[]', '["20","21","39","63","87","94"]', 10, 1);
