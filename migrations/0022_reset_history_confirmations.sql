-- Counts before this change included batch applies and code changes, so remembered codes start over at one hand-apply.
UPDATE learned SET uses = 1 WHERE uses > 1;
UPDATE supplier_classification_history SET usage_count = 1 WHERE usage_count > 1;
