-- BuildPro Construction Management Platform - Complete Database Schema
-- PostgreSQL 14+

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Organizations (Multi-tenant)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('gc', 'subcontractor', 'owner', 'architect', 'engineer')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    avatar_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- User Organization Memberships
CREATE TABLE user_organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'project_manager', 'superintendent', 'engineer', 'subcontractor', 'viewer')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, organization_id)
);

-- Projects
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    project_number VARCHAR(50) UNIQUE,
    owner_organization_id UUID REFERENCES organizations(id),
    gc_organization_id UUID REFERENCES organizations(id),
    location JSONB, -- {address, city, state, zip, coordinates}
    budget DECIMAL(15,2),
    start_date DATE,
    end_date DATE,
    status VARCHAR(50) DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
    settings JSONB DEFAULT '{}', -- Project-specific configuration
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Project Team Members
CREATE TABLE project_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    permissions JSONB DEFAULT '{}', -- Granular permissions override
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, user_id)
);

-- Documents (Base for all file attachments)
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT,
    mime_type VARCHAR(100),
    uploaded_by UUID REFERENCES users(id),
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Document Versions
CREATE TABLE document_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT,
    uploaded_by UUID REFERENCES users(id),
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(document_id, version_number)
);

-- Generic Entity Linking (polymorphic relationships)
CREATE TABLE entity_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type VARCHAR(50) NOT NULL,
    source_id UUID NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    target_id UUID NOT NULL,
    relationship VARCHAR(50),
    metadata JSONB DEFAULT '{}', -- e.g., coordinates for photo links
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_type, source_id, target_type, target_id, relationship)
);

CREATE INDEX idx_entity_links_source ON entity_links(source_type, source_id);
CREATE INDEX idx_entity_links_target ON entity_links(target_type, target_id);

-- ============================================================================
-- 1. DRAWINGS MODULE
-- ============================================================================

CREATE TABLE drawing_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    discipline VARCHAR(50), -- Architectural, Structural, MEP, Civil, etc.
    set_number VARCHAR(50),
    issue_date DATE,
    revision VARCHAR(20),
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'superseded')),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE drawing_sheets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drawing_set_id UUID NOT NULL REFERENCES drawing_sets(id) ON DELETE CASCADE,
    sheet_number VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    document_version_id UUID REFERENCES document_versions(id), -- Link to PDF
    page_number INTEGER,
    discipline VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(drawing_set_id, sheet_number)
);

CREATE TABLE drawing_markups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drawing_sheet_id UUID NOT NULL REFERENCES drawing_sheets(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id),
    markup_data JSONB NOT NULL, -- {type: 'rectangle'|'text'|'arrow', coordinates, content, style}
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 2. PHOTOS MODULE
-- ============================================================================

CREATE TABLE photo_albums (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    album_id UUID REFERENCES photo_albums(id) ON DELETE SET NULL,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    title VARCHAR(255),
    description TEXT,
    taken_at TIMESTAMP WITH TIME ZONE,
    location JSONB, -- GPS coordinates
    uploaded_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE photo_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    tag VARCHAR(100) NOT NULL,
    UNIQUE(photo_id, tag)
);

CREATE INDEX idx_photo_tags_tag ON photo_tags(tag);

-- ============================================================================
-- 3. RFIs (Requests for Information)
-- ============================================================================

CREATE TABLE rfis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    rfi_number VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    question TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'answered', 'closed')),
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    ball_in_court UUID REFERENCES users(id), -- Current responsible party
    due_date DATE,
    created_by UUID NOT NULL REFERENCES users(id),
    assigned_to UUID REFERENCES users(id),
    drawing_sheet_id UUID REFERENCES drawing_sheets(id),
    cost_impact BOOLEAN DEFAULT false,
    schedule_impact BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, rfi_number)
);

CREATE TABLE rfi_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfi_id UUID NOT NULL REFERENCES rfis(id) ON DELETE CASCADE,
    response_text TEXT NOT NULL,
    is_official BOOLEAN DEFAULT false,
    responded_by UUID NOT NULL REFERENCES users(id),
    responded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE rfi_distribution (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfi_id UUID NOT NULL REFERENCES rfis(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    role VARCHAR(50), -- 'to', 'cc'
    UNIQUE(rfi_id, user_id)
);

-- ============================================================================
-- 4. SUBMITTALS
-- ============================================================================

CREATE TABLE submittal_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    package_number VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    spec_section VARCHAR(50),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, package_number)
);

CREATE TABLE submittals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id UUID NOT NULL REFERENCES submittal_packages(id) ON DELETE CASCADE,
    submittal_number VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    type VARCHAR(50) CHECK (type IN ('product_data', 'shop_drawings', 'samples', 'design_data', 'test_reports', 'certificates')),
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'in_review', 'approved', 'approved_as_noted', 'revise_resubmit', 'rejected')),
    submitted_by UUID REFERENCES users(id),
    submitted_at TIMESTAMP WITH TIME ZONE,
    due_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(package_id, submittal_number)
);

CREATE TABLE submittal_review_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submittal_id UUID NOT NULL REFERENCES submittals(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    reviewer_id UUID NOT NULL REFERENCES users(id),
    role VARCHAR(50), -- 'contractor', 'architect', 'engineer', 'owner'
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'approved', 'approved_as_noted', 'revise_resubmit', 'rejected')),
    review_comments TEXT,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(submittal_id, step_number)
);

-- ============================================================================
-- 5. DAILY LOGS
-- ============================================================================

CREATE TABLE daily_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    log_date DATE NOT NULL,
    weather JSONB, -- {temperature, conditions, wind}
    work_performed TEXT,
    delays TEXT,
    is_submitted BOOLEAN DEFAULT false,
    submitted_by UUID REFERENCES users(id),
    submitted_at TIMESTAMP WITH TIME ZONE,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, log_date)
);

CREATE TABLE daily_log_manpower (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    daily_log_id UUID NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
    trade VARCHAR(100) NOT NULL,
    company_name VARCHAR(255),
    worker_count INTEGER NOT NULL,
    hours_worked DECIMAL(5,2)
);

CREATE TABLE daily_log_equipment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    daily_log_id UUID NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
    equipment_type VARCHAR(100) NOT NULL,
    quantity INTEGER NOT NULL,
    hours_used DECIMAL(5,2)
);

CREATE TABLE daily_log_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    daily_log_id UUID NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
    supplier VARCHAR(255),
    material VARCHAR(255) NOT NULL,
    quantity VARCHAR(100),
    delivery_time TIME
);

CREATE TABLE daily_log_visitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    daily_log_id UUID NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
    visitor_name VARCHAR(255) NOT NULL,
    company VARCHAR(255),
    purpose VARCHAR(255),
    time_in TIME,
    time_out TIME
);

CREATE TABLE daily_log_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    daily_log_id UUID NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
    activity VARCHAR(255) NOT NULL,
    location VARCHAR(255),
    notes TEXT
);

-- ============================================================================
-- 6. TASKS, PUNCH ITEMS, ISSUES
-- ============================================================================

CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    assigned_to UUID REFERENCES users(id),
    due_date DATE,
    location VARCHAR(255),
    trade VARCHAR(100),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE punch_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    item_number VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    location VARCHAR(255) NOT NULL,
    trade VARCHAR(100) NOT NULL,
    status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'verified', 'closed')),
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
    assigned_to UUID REFERENCES users(id),
    due_date DATE,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    verified_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(project_id, item_number)
);

CREATE TABLE issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    issue_number VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    location VARCHAR(255),
    trade VARCHAR(100),
    severity VARCHAR(20) DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'closed')),
    assigned_to UUID REFERENCES users(id),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(project_id, issue_number)
);

-- ============================================================================
-- 7. INSPECTIONS, OBSERVATIONS, INCIDENTS
-- ============================================================================

CREATE TABLE inspection_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE, -- NULL = global template
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50), -- safety, quality, progress, final
    sections JSONB NOT NULL, -- [{section_name, items: [{question, type, required}]}]
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inspection_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES inspection_templates(id),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    inspection_date DATE NOT NULL,
    inspector_id UUID NOT NULL REFERENCES users(id),
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'submitted', 'locked')),
    responses JSONB, -- Answers to template questions
    submitted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    inspection_run_id UUID REFERENCES inspection_runs(id),
    observation_number VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    location VARCHAR(255),
    severity VARCHAR(20) CHECK (severity IN ('low', 'medium', 'high')),
    status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_progress', 'resolved', 'closed')),
    assigned_to UUID REFERENCES users(id),
    due_date DATE,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(project_id, observation_number)
);

CREATE TABLE incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    incident_number VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    incident_date TIMESTAMP WITH TIME ZONE NOT NULL,
    location VARCHAR(255),
    type VARCHAR(50), -- safety, environmental, property_damage, near_miss
    severity VARCHAR(20) CHECK (severity IN ('minor', 'moderate', 'serious', 'critical')),
    status VARCHAR(50) DEFAULT 'reported' CHECK (status IN ('reported', 'investigating', 'action_taken', 'closed')),
    reported_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, incident_number)
);

CREATE TABLE incident_corrective_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    action_description TEXT NOT NULL,
    responsible_party UUID REFERENCES users(id),
    due_date DATE,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- ============================================================================
-- 8. FINANCIALS & CHANGE MANAGEMENT
-- ============================================================================

CREATE TABLE budget_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    cost_code VARCHAR(50) NOT NULL,
    description VARCHAR(255) NOT NULL,
    category VARCHAR(100), -- Labor, Materials, Equipment, Subcontractor, etc.
    budgeted_amount DECIMAL(15,2) NOT NULL,
    committed_amount DECIMAL(15,2) DEFAULT 0,
    invoiced_amount DECIMAL(15,2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, cost_code)
);

CREATE TABLE commitments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    commitment_number VARCHAR(50) NOT NULL,
    vendor_organization_id UUID REFERENCES organizations(id),
    title VARCHAR(255) NOT NULL,
    type VARCHAR(50) CHECK (type IN ('purchase_order', 'subcontract', 'service_agreement')),
    total_amount DECIMAL(15,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'executed', 'closed')),
    start_date DATE,
    end_date DATE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, commitment_number)
);

CREATE TABLE commitment_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    commitment_id UUID NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
    budget_line_id UUID REFERENCES budget_lines(id),
    line_number INTEGER NOT NULL,
    description VARCHAR(255) NOT NULL,
    quantity DECIMAL(10,2),
    unit_price DECIMAL(15,2),
    amount DECIMAL(15,2) NOT NULL,
    UNIQUE(commitment_id, line_number)
);

CREATE TABLE sov_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    commitment_id UUID NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    description VARCHAR(255) NOT NULL,
    scheduled_value DECIMAL(15,2) NOT NULL,
    previous_amount DECIMAL(15,2) DEFAULT 0,
    current_amount DECIMAL(15,2) DEFAULT 0,
    UNIQUE(commitment_id, line_number)
);

CREATE TABLE commitment_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    commitment_id UUID NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
    invoice_number VARCHAR(50) NOT NULL,
    invoice_date DATE NOT NULL,
    period_start DATE,
    period_end DATE,
    total_amount DECIMAL(15,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'paid')),
    submitted_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(commitment_id, invoice_number)
);

CREATE TABLE commitment_invoice_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES commitment_invoices(id) ON DELETE CASCADE,
    sov_line_id UUID REFERENCES sov_lines(id),
    line_number INTEGER NOT NULL,
    description VARCHAR(255) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    UNIQUE(invoice_id, line_number)
);

CREATE TABLE change_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    event_number VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    estimated_cost DECIMAL(15,2),
    estimated_days INTEGER,
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected', 'converted')),
    source_rfi_id UUID REFERENCES rfis(id),
    source_submittal_id UUID REFERENCES submittals(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, event_number)
);

CREATE TABLE change_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    change_order_number VARCHAR(50) NOT NULL,
    change_event_id UUID REFERENCES change_events(id),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    cost_impact DECIMAL(15,2) NOT NULL,
    schedule_impact INTEGER, -- days
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'executed')),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, change_order_number)
);

-- ============================================================================
-- 9. INTEGRATIONS & EVENTS
-- ============================================================================

CREATE TABLE system_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL, -- 'rfi.created', 'rfi.status_changed', etc.
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    project_id UUID REFERENCES projects(id),
    user_id UUID REFERENCES users(id),
    event_data JSONB NOT NULL, -- Full event payload
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_system_events_type ON system_events(event_type);
CREATE INDEX idx_system_events_entity ON system_events(entity_type, entity_id);
CREATE INDEX idx_system_events_created ON system_events(created_at);

CREATE TABLE webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id),
    name VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    event_types TEXT[] NOT NULL, -- Array of subscribed events
    secret VARCHAR(255), -- For signature verification
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES system_events(id),
    status VARCHAR(50) CHECK (status IN ('pending', 'success', 'failed')),
    http_status INTEGER,
    response_body TEXT,
    attempt_count INTEGER DEFAULT 0,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    delivered_at TIMESTAMP WITH TIME ZONE
);

-- ============================================================================
-- NOTIFICATIONS
-- ============================================================================

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- 'mention', 'assignment', 'status_change', 'due_soon'
    title VARCHAR(255) NOT NULL,
    message TEXT,
    entity_type VARCHAR(50),
    entity_id UUID,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);

-- ============================================================================
-- AUDIT LOG
-- ============================================================================

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(50) NOT NULL, -- 'create', 'update', 'delete'
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    changes JSONB, -- Before/after values
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);

-- ============================================================================
-- TRIGGERS FOR updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to all tables with updated_at
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_drawing_sets_updated_at BEFORE UPDATE ON drawing_sets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_drawing_markups_updated_at BEFORE UPDATE ON drawing_markups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_rfis_updated_at BEFORE UPDATE ON rfis FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_submittals_updated_at BEFORE UPDATE ON submittals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_daily_logs_updated_at BEFORE UPDATE ON daily_logs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_punch_items_updated_at BEFORE UPDATE ON punch_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_issues_updated_at BEFORE UPDATE ON issues FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_inspection_runs_updated_at BEFORE UPDATE ON inspection_runs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_budget_lines_updated_at BEFORE UPDATE ON budget_lines FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_commitments_updated_at BEFORE UPDATE ON commitments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_commitment_invoices_updated_at BEFORE UPDATE ON commitment_invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_change_events_updated_at BEFORE UPDATE ON change_events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_change_orders_updated_at BEFORE UPDATE ON change_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

CREATE INDEX idx_projects_gc ON projects(gc_organization_id);
CREATE INDEX idx_projects_owner ON projects(owner_organization_id);
CREATE INDEX idx_project_members_project ON project_members(project_id);
CREATE INDEX idx_project_members_user ON project_members(user_id);
CREATE INDEX idx_documents_project ON documents(project_id);
CREATE INDEX idx_drawing_sheets_set ON drawing_sheets(drawing_set_id);
CREATE INDEX idx_photos_album ON photos(album_id);
CREATE INDEX idx_photos_project ON photos(project_id);
CREATE INDEX idx_rfis_project ON rfis(project_id);
CREATE INDEX idx_rfis_status ON rfis(status);
CREATE INDEX idx_submittals_package ON submittals(package_id);
CREATE INDEX idx_daily_logs_project_date ON daily_logs(project_id, log_date);
CREATE INDEX idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX idx_punch_items_assigned ON punch_items(assigned_to);
CREATE INDEX idx_budget_lines_project ON budget_lines(project_id);
CREATE INDEX idx_commitments_project ON commitments(project_id);