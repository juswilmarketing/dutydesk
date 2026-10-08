-- Golden classification evaluation dataset (Phase 1 / Phase 4 foundation)
CREATE TABLE IF NOT EXISTS classification_test_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_description TEXT NOT NULL,
  supplier TEXT,
  expected_product TEXT,
  expected_material TEXT,
  expected_chapter TEXT,
  expected_heading TEXT,
  expected_tariff TEXT,
  acceptable_alternatives_json TEXT NOT NULL DEFAULT '[]',
  prohibited_chapters_json TEXT NOT NULL DEFAULT '[]',
  required_question TEXT,
  notes TEXT,
  approved_by TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO classification_test_cases (
  raw_description, supplier, expected_product, expected_material, expected_chapter,
  expected_heading, expected_tariff, acceptable_alternatives_json, prohibited_chapters_json,
  required_question, notes, approved_by, active
) VALUES
('B TOWELS', NULL, 'bath towels', NULL, '63', '6302', NULL, '["6302"]', '["01","02","20","28","84","85"]', 'material', 'Invoice shorthand for bath towels; material clarification expected', 'system', 1),
('BATH TOWELS', NULL, 'bath towels', NULL, '63', '6302', NULL, '["6302"]', '["01","02","20","28","84","85"]', 'material', NULL, 'system', 1),
('PAPER TOWELS', NULL, 'paper towels', 'paper', '48', NULL, NULL, '["4818"]', '["63","01","84"]', NULL, 'Paper towels must not route to textile chapter 63', 'system', 1),
('SHOWER CAPS', NULL, 'shower caps', NULL, NULL, NULL, NULL, '["3926","6505","6307"]', '["01","20","84"]', 'material', 'Material-critical; chapters 39/65/63 acceptable depending on construction', 'system', 1),
('PLASTIC SHOWER CAPS', NULL, 'shower caps', 'plastic', '39', NULL, NULL, '["3926"]', '["01","20","63","65"]', NULL, NULL, 'system', 1),
('NONWOVEN SHOWER CAPS', NULL, 'shower caps', 'nonwoven textile', '63', NULL, NULL, '["6307","6505"]', '["01","20","39"]', NULL, NULL, 'system', 1),
('FL-ACT FLEXLAG ACTIVATOR', NULL, 'Flex-Lag activator', NULL, '38', NULL, NULL, '["38","35"]', '["01","20","63","84"]', 'primary_function', 'No unsupported exact national-line certainty without function', 'system', 1),
('3M METAL RESTORER AND POLISH', NULL, 'metal restorer and polish', NULL, '34', '3405', NULL, '["3405"]', '["20"]', NULL, 'Cleaning/polishing preparation; reject chapter 20', 'system', 1),
('LADIES SANDALS', NULL, 'ladies sandals', NULL, '64', NULL, NULL, '["6402","6403","6404"]', '["01","20","84"]', NULL, NULL, 'system', 1),
('LED DRIVER', NULL, 'LED driver', NULL, '85', NULL, NULL, '["8504","8537"]', '["01","20","63"]', NULL, NULL, 'system', 1),
('STAINLESS STEEL TANK', NULL, 'stainless steel tank', 'stainless steel', '73', NULL, NULL, '["7309","7311"]', '["01","20","63"]', NULL, NULL, 'system', 1),
('CAMPING COT', NULL, 'camping cot', NULL, '94', NULL, NULL, '["9401","9403"]', '["01","20"]', NULL, NULL, 'system', 1),
('DICED TOMATOES', NULL, 'diced tomatoes', NULL, '20', NULL, NULL, '["2002"]', '["63","84","85"]', NULL, NULL, 'system', 1),
('VOLTAGE PROTECTOR', NULL, 'voltage protector', NULL, '85', NULL, NULL, '["8535","8536","8543"]', '["01","20","63"]', NULL, NULL, 'system', 1),
('COPPER TUBES', NULL, 'copper tubes', 'copper', '74', NULL, NULL, '["7411"]', '["01","20","63"]', NULL, NULL, 'system', 1);
