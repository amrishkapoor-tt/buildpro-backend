-- Drawing Workflow Enhancement Migration
-- Adds version control, markup, distribution, and workflow state management for drawings

BEGIN;

-- ============================================================================
-- PHASE 1: DRAWING METADATA ENHANCEMENTS
-- ============================================================================

-- Add drawing-specific metadata to documents table
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS drawing_number VARCHAR(100),
ADD COLUMN IF NOT EXISTS discipline VARCHAR(50), -- A (Arch), S (Struct), M (Mech), E (Elec), P (Plumb), C (Civil)
ADD COLUMN IF NOT EXISTS sheet_title VARCHAR(255),
ADD COLUMN IF NOT EXISTS revision_number VARCHAR(20), -- A, B, C or 1, 2, 3 or Rev A, etc.
ADD COLUMN IF NOT EXISTS issue_date DATE,
ADD COLUMN IF NOT EXISTS supersedes_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS is_current_revision BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS drawing_scale VARCHAR(50), -- 1/4"=1'-0", 1:100, etc.
ADD COLUMN IF NOT EXISTS sheet_size VARCHAR(20); -- A, B, C, D, E, ARCH D, etc.

-- Create index for drawing lookups
CREATE INDEX IF NOT EXISTS idx_documents_drawing_number ON documents(drawing_number);
CREATE INDEX IF NOT EXISTS idx_documents_discipline ON documents(discipline);
CREATE INDEX IF NOT EXISTS idx_documents_revision ON documents(revision_number);
CREATE INDEX IF NOT EXISTS idx_documents_is_current ON documents(is_current_revision) WHERE is_current_revision = true;

-- ============================================================================
-- DRAWING WORKFLOW STATES
-- ============================================================================

-- Drawing workflow state tracking
CREATE TABLE IF NOT EXISTS drawing_workflow_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    workflow_state VARCHAR(50) NOT NULL, -- received, under_review, markup_in_progress, asi_pending, distributed, superseded, archived
    assigned_to UUID REFERENCES users(id),
    assigned_at TIMESTAMP WITH TIME ZONE,
    due_date DATE,
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_drawing_workflow_document ON drawing_workflow_states(document_id);
CREATE INDEX idx_drawing_workflow_state ON drawing_workflow_states(workflow_state);
CREATE INDEX idx_drawing_workflow_assigned ON drawing_workflow_states(assigned_to);

-- Workflow history/transitions
CREATE TABLE IF NOT EXISTS drawing_workflow_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    from_state VARCHAR(50),
    to_state VARCHAR(50) NOT NULL,
    changed_by UUID REFERENCES users(id),
    change_reason TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_drawing_workflow_history_document ON drawing_workflow_history(document_id);
CREATE INDEX idx_drawing_workflow_history_created ON drawing_workflow_history(created_at DESC);

-- ============================================================================
-- DRAWING MARKUPS
-- ============================================================================

-- Drawing markups/annotations
CREATE TABLE IF NOT EXISTS drawing_markups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id),
    markup_data JSONB NOT NULL, -- Canvas annotations as JSON (paths, shapes, text, etc.)
    markup_type VARCHAR(50), -- annotation, clash, rfi_reference, asi_reference
    status VARCHAR(20) DEFAULT 'open', -- open, resolved, void
    position_x FLOAT,
    position_y FLOAT,
    comment TEXT,
    color VARCHAR(20),
    linked_entity_type VARCHAR(50), -- rfi, asi, punch_item, etc.
    linked_entity_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_by UUID REFERENCES users(id),
    resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_drawing_markups_document ON drawing_markups(document_id);
CREATE INDEX idx_drawing_markups_created_by ON drawing_markups(created_by);
CREATE INDEX idx_drawing_markups_status ON drawing_markups(status);
CREATE INDEX idx_drawing_markups_linked ON drawing_markups(linked_entity_type, linked_entity_id);

-- ============================================================================
-- DRAWING REVIEWS & COORDINATION
-- ============================================================================

-- Drawing reviews (coordination review process)
CREATE TABLE IF NOT EXISTS drawing_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES users(id),
    discipline VARCHAR(50), -- Which discipline is this reviewer checking
    review_status VARCHAR(20) DEFAULT 'pending', -- pending, in_progress, approved, rejected, comments
    review_notes TEXT,
    clash_detected BOOLEAN DEFAULT false,
    clash_description TEXT,
    requested_by UUID REFERENCES users(id),
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_drawing_reviews_document ON drawing_reviews(document_id);
CREATE INDEX idx_drawing_reviews_reviewer ON drawing_reviews(reviewer_id);
CREATE INDEX idx_drawing_reviews_status ON drawing_reviews(review_status);

-- Review checklist items
CREATE TABLE IF NOT EXISTS drawing_review_checklist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id UUID NOT NULL REFERENCES drawing_reviews(id) ON DELETE CASCADE,
    item_description TEXT NOT NULL,
    is_checked BOOLEAN DEFAULT false,
    notes TEXT,
    checked_by UUID REFERENCES users(id),
    checked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_review_checklist_review ON drawing_review_checklist(review_id);

-- ============================================================================
-- DRAWING DISTRIBUTION
-- ============================================================================

-- Drawing distribution tracking
CREATE TABLE IF NOT EXISTS drawing_distributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    distributed_to_user_id UUID REFERENCES users(id),
    distributed_to_role VARCHAR(50), -- For role-based distribution
    distribution_method VARCHAR(50) DEFAULT 'manual', -- manual, auto, email, print
    distribution_notes TEXT,
    distributed_by UUID REFERENCES users(id),
    distributed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    acknowledged BOOLEAN DEFAULT false,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_drawing_distributions_document ON drawing_distributions(document_id);
CREATE INDEX idx_drawing_distributions_user ON drawing_distributions(distributed_to_user_id);
CREATE INDEX idx_drawing_distributions_role ON drawing_distributions(distributed_to_role);
CREATE INDEX idx_drawing_distributions_acknowledged ON drawing_distributions(acknowledged);

-- ============================================================================
-- ASI (ARCHITECT SUPPLEMENTAL INSTRUCTIONS)
-- ============================================================================

-- ASI tracking
CREATE TABLE IF NOT EXISTS asis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    asi_number VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    issued_by VARCHAR(255), -- Architect/Engineer firm name
    issue_date DATE,
    received_date DATE,
    status VARCHAR(50) DEFAULT 'received', -- received, under_review, incorporated, superseded
    affects_cost BOOLEAN DEFAULT false,
    affects_schedule BOOLEAN DEFAULT false,
    estimated_cost_impact DECIMAL(15, 2),
    estimated_schedule_impact_days INTEGER,
    incorporation_notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, asi_number)
);

CREATE INDEX idx_asis_project ON asis(project_id);
CREATE INDEX idx_asis_number ON asis(asi_number);
CREATE INDEX idx_asis_status ON asis(status);
CREATE INDEX idx_asis_issue_date ON asis(issue_date DESC);

-- ASI-Drawing relationships (which ASIs affect which drawings)
CREATE TABLE IF NOT EXISTS asi_drawings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asi_id UUID NOT NULL REFERENCES asis(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    impact_description TEXT,
    requires_revision BOOLEAN DEFAULT true,
    revision_completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(asi_id, document_id)
);

CREATE INDEX idx_asi_drawings_asi ON asi_drawings(asi_id);
CREATE INDEX idx_asi_drawings_document ON asi_drawings(document_id);

-- ============================================================================
-- DRAWING SETS (Grouping multiple sheets)
-- ============================================================================

-- Drawing sets/packages
CREATE TABLE IF NOT EXISTS drawing_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    set_name VARCHAR(255) NOT NULL,
    set_description TEXT,
    set_type VARCHAR(50), -- bid_set, permit_set, construction_set, coordination_set, etc.
    issue_date DATE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_drawing_sets_project ON drawing_sets(project_id);

-- Drawing set membership
CREATE TABLE IF NOT EXISTS drawing_set_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drawing_set_id UUID NOT NULL REFERENCES drawing_sets(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    sequence_order INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(drawing_set_id, document_id)
);

CREATE INDEX idx_drawing_set_members_set ON drawing_set_members(drawing_set_id);
CREATE INDEX idx_drawing_set_members_document ON drawing_set_members(document_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_drawing_workflow_states_updated_at ON drawing_workflow_states;
CREATE TRIGGER update_drawing_workflow_states_updated_at
BEFORE UPDATE ON drawing_workflow_states
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_drawing_markups_updated_at ON drawing_markups;
CREATE TRIGGER update_drawing_markups_updated_at
BEFORE UPDATE ON drawing_markups
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_drawing_reviews_updated_at ON drawing_reviews;
CREATE TRIGGER update_drawing_reviews_updated_at
BEFORE UPDATE ON drawing_reviews
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_asis_updated_at ON asis;
CREATE TRIGGER update_asis_updated_at
BEFORE UPDATE ON asis
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_drawing_sets_updated_at ON drawing_sets;
CREATE TRIGGER update_drawing_sets_updated_at
BEFORE UPDATE ON drawing_sets
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'documents' AND column_name LIKE '%drawing%';
-- SELECT * FROM drawing_workflow_states;
-- SELECT * FROM drawing_markups;
-- SELECT * FROM asis;
