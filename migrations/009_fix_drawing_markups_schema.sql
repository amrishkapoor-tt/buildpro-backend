-- Fix drawing_markups schema to support document-based markups
-- Make drawing_sheet_id nullable to allow markups on documents without drawing_sheets

BEGIN;

-- Make drawing_sheet_id nullable (if it exists)
-- This allows markups to be associated with documents directly
DO $$
BEGIN
    -- Check if drawing_sheet_id column exists
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'drawing_markups'
        AND column_name = 'drawing_sheet_id'
    ) THEN
        -- Make it nullable
        ALTER TABLE drawing_markups
        ALTER COLUMN drawing_sheet_id DROP NOT NULL;

        RAISE NOTICE 'drawing_sheet_id is now nullable';
    ELSE
        RAISE NOTICE 'drawing_sheet_id column does not exist, skipping';
    END IF;
END $$;

-- Ensure document_id column exists (from 008_drawing_workflow_v2.sql)
ALTER TABLE drawing_markups
ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES documents(id) ON DELETE CASCADE;

-- Create index if not exists
CREATE INDEX IF NOT EXISTS idx_drawing_markups_document ON drawing_markups(document_id);

-- Add constraint to ensure at least one FK is present
-- Either drawing_sheet_id OR document_id must be non-null
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'drawing_markups_must_have_reference'
    ) THEN
        ALTER TABLE drawing_markups
        ADD CONSTRAINT drawing_markups_must_have_reference
        CHECK (drawing_sheet_id IS NOT NULL OR document_id IS NOT NULL);

        RAISE NOTICE 'Added constraint: at least one of drawing_sheet_id or document_id must be present';
    END IF;
END $$;

COMMIT;

-- Verification query
-- SELECT column_name, is_nullable, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'drawing_markups'
-- AND column_name IN ('drawing_sheet_id', 'document_id');
