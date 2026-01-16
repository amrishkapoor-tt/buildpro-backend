-- BuildPro Documents Module Enhancement Migration
-- This migration adds folder hierarchy, versioning metadata, tags, categories, and more

BEGIN;

-- ============================================================================
-- PHASE 1: FOLDER HIERARCHY
-- ============================================================================

-- Create document_folders table
CREATE TABLE IF NOT EXISTS document_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    parent_folder_id UUID REFERENCES document_folders(id) ON DELETE CASCADE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for folders
CREATE INDEX IF NOT EXISTS idx_document_folders_project ON document_folders(project_id);
CREATE INDEX IF NOT EXISTS idx_document_folders_parent ON document_folders(parent_folder_id);

-- Enhance documents table with new columns
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES document_folders(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS tags TEXT[],
ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS category VARCHAR(50);

-- Add indexes for documents
CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id);
CREATE INDEX IF NOT EXISTS idx_documents_tags ON documents USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);

-- ============================================================================
-- PHASE 2: DOCUMENT VERSIONING ENHANCEMENTS
-- ============================================================================

-- Enhance document_versions table
ALTER TABLE document_versions
ADD COLUMN IF NOT EXISTS version_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS change_description TEXT,
ADD COLUMN IF NOT EXISTS is_current BOOLEAN DEFAULT true;

-- Only one current version per document (drop if exists, then recreate)
DROP INDEX IF EXISTS idx_document_versions_current;
CREATE UNIQUE INDEX idx_document_versions_current
ON document_versions(document_id) WHERE is_current = true;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Add trigger for folders updated_at (if not already exists)
DROP TRIGGER IF EXISTS update_document_folders_updated_at ON document_folders;
CREATE TRIGGER update_document_folders_updated_at
BEFORE UPDATE ON document_folders
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Additional performance indexes
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_at ON documents(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_is_favorite ON documents(is_favorite) WHERE is_favorite = true;
CREATE INDEX IF NOT EXISTS idx_document_versions_document ON document_versions(document_id);

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES (Run these after migration to verify)
-- ============================================================================
-- SELECT * FROM document_folders;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'documents';
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'document_versions';
