-- Async document processing jobs (scanned PDF pipeline)

CREATE TABLE IF NOT EXISTS document_processing_jobs (
  id TEXT PRIMARY KEY,
  user_id INTEGER,
  username TEXT,
  document_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'application/pdf',
  status TEXT NOT NULL DEFAULT 'queued',
  current_stage TEXT,
  pages_total INTEGER NOT NULL DEFAULT 0,
  pages_completed INTEGER NOT NULL DEFAULT 0,
  progress_percent INTEGER NOT NULL DEFAULT 0,
  batch_size INTEGER NOT NULL DEFAULT 4,
  current_batch INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  result_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_doc_jobs_status ON document_processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_doc_jobs_user ON document_processing_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_doc_jobs_updated ON document_processing_jobs(updated_at);

CREATE TABLE IF NOT EXISTS document_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  image_r2_key TEXT,
  raw_ocr_text TEXT,
  cleaned_text TEXT,
  ocr_confidence REAL,
  processing_time_ms INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(job_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_doc_pages_job ON document_pages(job_id);
CREATE INDEX IF NOT EXISTS idx_doc_pages_status ON document_pages(status);

CREATE TABLE IF NOT EXISTS document_batch_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  batch_index INTEGER NOT NULL,
  from_page INTEGER NOT NULL,
  to_page INTEGER NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result_json TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_doc_batch_job ON document_batch_runs(job_id);
