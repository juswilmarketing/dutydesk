-- Additional canonical resolver vocabulary added after initial resolver release.

INSERT OR IGNORE INTO canonical_products
  (canonical_name, normalized_name, industry_code, industry_name, product_family,
   typical_materials_json, typical_chapters_json, common_uses_json, typical_attributes_json)
VALUES
  ('Women''s Sandals', 'women sandals', 'footwear', 'Footwear', 'Open Footwear',
   '["leather","textile","rubber","plastic"]', '["64"]',
   '["casual wear","retail"]', '["upper material","sole material","gender"]');

INSERT OR IGNORE INTO product_aliases
  (canonical_product_id, alias, normalized_alias, compact_alias, phonetic_key, source)
SELECT id, 'Ladies Sandals', 'ladies sandals', 'ladiessandals', 'L322', 'seed'
FROM canonical_products WHERE normalized_name = 'women sandals';
