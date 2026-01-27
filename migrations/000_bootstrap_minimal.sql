-- Minimal Bootstrap Schema for Workflow Engine Testing
-- This creates just the bare minimum tables needed for workflow engine to function

BEGIN;

-- Users table (minimal version)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'viewer',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Projects table (minimal version)
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_name VARCHAR(255) NOT NULL,
    project_number VARCHAR(100),
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Organizations table (minimal version)
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- User-Organization relationship
CREATE TABLE IF NOT EXISTS user_organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, organization_id, project_id)
);

-- Submittals table (for testing workflow integration)
CREATE TABLE IF NOT EXISTS submittals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    submittal_number VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'draft',
    submitted_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, submittal_number)
);

-- RFIs table (for testing workflow integration)
CREATE TABLE IF NOT EXISTS rfis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    rfi_number VARCHAR(100) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'draft',
    assigned_to UUID REFERENCES users(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, rfi_number)
);

-- Change Orders table (for testing workflow integration)
CREATE TABLE IF NOT EXISTS change_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    change_order_number VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    amount DECIMAL(15, 2),
    status VARCHAR(50) DEFAULT 'pending',
    approved_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, change_order_number)
);

-- Documents table (for drawings workflow)
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    document_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500),
    document_type VARCHAR(50),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- System events table (for event logging)
CREATE TABLE IF NOT EXISTS system_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    payload JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    changes JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    notification_type VARCHAR(50),
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_organizations_user ON user_organizations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_organizations_project ON user_organizations(project_id);
CREATE INDEX IF NOT EXISTS idx_submittals_project ON submittals(project_id);
CREATE INDEX IF NOT EXISTS idx_rfis_project ON rfis(project_id);
CREATE INDEX IF NOT EXISTS idx_change_orders_project ON change_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

-- Insert test data
INSERT INTO organizations (id, name) VALUES
('00000000-0000-0000-0000-000000000001', 'Test Organization')
ON CONFLICT DO NOTHING;

INSERT INTO projects (id, project_name, project_number) VALUES
('00000000-0000-0000-0000-000000000101', 'Test Project Alpha', 'PROJ-001'),
('00000000-0000-0000-0000-000000000102', 'Test Project Beta', 'PROJ-002')
ON CONFLICT DO NOTHING;

-- Create test users with different roles
INSERT INTO users (id, email, name, password_hash, role) VALUES
('00000000-0000-0000-0000-000000000201', 'admin@test.com', 'Admin User', '$2b$10$placeholder', 'admin'),
('00000000-0000-0000-0000-000000000202', 'pm@test.com', 'Project Manager', '$2b$10$placeholder', 'project_manager'),
('00000000-0000-0000-0000-000000000203', 'super@test.com', 'Superintendent', '$2b$10$placeholder', 'superintendent'),
('00000000-0000-0000-0000-000000000204', 'arch@test.com', 'Architect', '$2b$10$placeholder', 'architect'),
('00000000-0000-0000-0000-000000000205', 'eng@test.com', 'Engineer', '$2b$10$placeholder', 'engineer')
ON CONFLICT DO NOTHING;

-- Assign users to project with roles
INSERT INTO user_organizations (user_id, organization_id, project_id, role) VALUES
('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 'admin'),
('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 'project_manager'),
('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 'superintendent'),
('00000000-0000-0000-0000-000000000204', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 'architect'),
('00000000-0000-0000-0000-000000000205', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 'engineer')
ON CONFLICT DO NOTHING;

-- Create test submittals
INSERT INTO submittals (id, project_id, submittal_number, title, status, submitted_by) VALUES
('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000101', 'S-001', 'HVAC Equipment Submittal', 'draft', '00000000-0000-0000-0000-000000000203'),
('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000101', 'S-002', 'Structural Steel Submittal', 'submitted', '00000000-0000-0000-0000-000000000203')
ON CONFLICT DO NOTHING;

COMMIT;

-- Verify
SELECT 'Bootstrap complete!' as message;
SELECT COUNT(*) as user_count FROM users;
SELECT COUNT(*) as project_count FROM projects;
SELECT COUNT(*) as submittal_count FROM submittals;
