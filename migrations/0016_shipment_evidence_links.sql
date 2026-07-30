-- Link invoice, SDS, packing list and other OCR jobs into one shipment evidence set.

ALTER TABLE document_processing_jobs ADD COLUMN shipment_id TEXT;
ALTER TABLE document_processing_jobs ADD COLUMN document_type TEXT NOT NULL DEFAULT 'commercial_invoice';

CREATE INDEX IF NOT EXISTS idx_document_jobs_shipment ON document_processing_jobs(shipment_id);

UPDATE document_processing_jobs
SET shipment_id = id
WHERE shipment_id IS NULL;

UPDATE classification_lines
SET classification_status = CASE
  WHEN classification_status = 'Product Detected' THEN 'Product Resolved'
  WHEN classification_status = 'Classification Failed' THEN 'Needs Review'
  ELSE classification_status
END;
