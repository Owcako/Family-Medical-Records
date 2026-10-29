-- database-schema.svg#D1: managed family members; slugs are user-confirmed labels.
CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    aliases_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- database-schema.svg#D11: only codes in the controlled catalog are valid.
CREATE TABLE IF NOT EXISTS departments (
    code TEXT PRIMARY KEY CHECK(length(code) = 8),
    name_en TEXT NOT NULL,
    name_zh TEXT NOT NULL,
    aliases_json TEXT NOT NULL,
    catalog_version TEXT NOT NULL
);

-- database-schema.svg#D2: one organizational archive can own several documents.
CREATE TABLE IF NOT EXISTS medical_records (
    id TEXT PRIMARY KEY,
    patient_id TEXT REFERENCES patients(id) ON DELETE RESTRICT,
    patient_status TEXT NOT NULL DEFAULT 'missing',
    patient_provenance TEXT NOT NULL DEFAULT 'documents',
    title TEXT NOT NULL,
    title_provenance TEXT NOT NULL DEFAULT 'documents',
    date_label TEXT,
    date_status TEXT NOT NULL DEFAULT 'missing',
    date_precision TEXT,
    department_status TEXT NOT NULL DEFAULT 'missing',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS records_by_patient_date ON medical_records(patient_id, date_label);

-- database-schema.svg#D3: enduring document IDs preserve existing /api/files links.
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL REFERENCES medical_records(id) ON DELETE CASCADE,
    operation TEXT UNIQUE NOT NULL,
    fingerprint TEXT NOT NULL,
    title TEXT NOT NULL,
    original_filename TEXT,
    media_type TEXT NOT NULL,
    origin TEXT NOT NULL,
    revision INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_by_record ON documents(record_id, created_at);

-- database-schema.svg#D4: immutable original bytes stay inside SQLite.
CREATE TABLE IF NOT EXISTS document_sources (
    document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    sha256 TEXT NOT NULL,
    content BLOB NOT NULL
);
CREATE TRIGGER IF NOT EXISTS immutable_document_source
BEFORE UPDATE ON document_sources BEGIN
    SELECT RAISE(ABORT, 'Preserved source cannot be overwritten');
END;

-- database-schema.svg#D5: editing changes current text, never the initial text.
CREATE TABLE IF NOT EXISTS document_texts (
    document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    initial_text TEXT,
    current_text TEXT,
    text_origin TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER IF NOT EXISTS immutable_initial_text
BEFORE UPDATE OF initial_text ON document_texts
WHEN OLD.initial_text IS NOT NULL AND NEW.initial_text IS NOT OLD.initial_text BEGIN
    SELECT RAISE(ABORT, 'Initial text cannot be overwritten');
END;

-- database-schema.svg#D6: processing failures and text-check outcomes are independent.
CREATE TABLE IF NOT EXISTS document_processing (
    document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    stage TEXT NOT NULL,
    attempt TEXT,
    error TEXT,
    extraction_status TEXT NOT NULL,
    extraction_error TEXT,
    check_status TEXT NOT NULL,
    check_error TEXT,
    checked_text_revision INTEGER,
    concerns_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS processing_by_status ON document_processing(status);

-- database-schema.svg#D7: preserve source classifications, ambiguity and provenance.
CREATE TABLE IF NOT EXISTS document_metadata (
    document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    classifications_json TEXT,
    department_catalog_version TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS record_departments (
    record_id TEXT NOT NULL REFERENCES medical_records(id) ON DELETE CASCADE,
    department_code TEXT NOT NULL REFERENCES departments(code),
    PRIMARY KEY(record_id, department_code)
);
CREATE INDEX IF NOT EXISTS records_by_department ON record_departments(department_code, record_id);
CREATE TABLE IF NOT EXISTS record_diseases (
    record_id TEXT NOT NULL REFERENCES medical_records(id) ON DELETE CASCADE,
    value TEXT NOT NULL,
    PRIMARY KEY(record_id, value)
);
CREATE INDEX IF NOT EXISTS records_by_disease ON record_diseases(value, record_id);

-- database-schema.svg#D8: clinical index content references the saved text revision.
CREATE TABLE IF NOT EXISTS document_indexes (
    document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    content_json TEXT,
    text_revision INTEGER NOT NULL,
    status TEXT NOT NULL
);

-- database-schema.svg#D9: archive-level evidence index, not a fabricated visit narrative.
CREATE TABLE IF NOT EXISTS record_abstracts (
    record_id TEXT PRIMARY KEY REFERENCES medical_records(id) ON DELETE CASCADE,
    content_json TEXT NOT NULL,
    based_on_revision INTEGER NOT NULL,
    status TEXT NOT NULL,
    catalog_version TEXT NOT NULL
);

-- database-schema.svg#D10: durable invalidation lives in SQLite, not marker files.
CREATE TABLE IF NOT EXISTS index_jobs (
    record_id TEXT PRIMARY KEY REFERENCES medical_records(id) ON DELETE CASCADE,
    target_revision INTEGER NOT NULL,
    indexed_revision INTEGER,
    state TEXT NOT NULL,
    reason TEXT NOT NULL,
    error TEXT,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS index_jobs_by_state ON index_jobs(state);
