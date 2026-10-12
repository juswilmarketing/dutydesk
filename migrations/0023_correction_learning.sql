-- Clerk corrections become regression cases; track overrides of Strong applies.
ALTER TABLE classification_test_cases ADD COLUMN source TEXT NOT NULL DEFAULT 'seed';
ALTER TABLE classification_test_cases ADD COLUMN replaced_code TEXT;
ALTER TABLE classification_test_cases ADD COLUMN replaced_label TEXT;
ALTER TABLE classification_approvals ADD COLUMN confidence_label TEXT;
ALTER TABLE classification_approvals ADD COLUMN overrode_label TEXT;
CREATE INDEX IF NOT EXISTS idx_classification_test_cases_source
  ON classification_test_cases(source, active);
