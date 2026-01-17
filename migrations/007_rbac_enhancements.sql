-- RBAC Enhancements Migration
-- Adds project ownership tracking

-- Add project ownership columns
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_user_id);

-- Note: audit_logs table already exists in schema (from initial setup)
-- If it doesn't exist, uncomment and run:
/*
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID,
  changes JSONB,
  ip_address VARCHAR(50),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
*/
