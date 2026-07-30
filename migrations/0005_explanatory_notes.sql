CREATE TABLE IF NOT EXISTS explanatory_note_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  version TEXT,
  chapter TEXT,
  section TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  chunk_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_en_docs_status ON explanatory_note_documents(status);
CREATE INDEX IF NOT EXISTS idx_en_docs_chapter ON explanatory_note_documents(chapter);

CREATE TABLE IF NOT EXISTS explanatory_note_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES explanatory_note_documents(id) ON DELETE CASCADE,
  section TEXT,
  chapter TEXT,
  heading TEXT,
  subheading TEXT,
  page_number INTEGER,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  chunk_text TEXT NOT NULL,
  keywords TEXT,
  embedding TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_en_chunks_doc ON explanatory_note_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_en_chunks_chapter ON explanatory_note_chunks(chapter);
CREATE INDEX IF NOT EXISTS idx_en_chunks_heading ON explanatory_note_chunks(heading);
