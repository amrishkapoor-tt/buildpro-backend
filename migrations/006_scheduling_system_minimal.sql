-- ============================================================================
-- MINIMAL SCHEDULING TABLES - Just what's needed for dashboard analytics
-- ============================================================================

-- Schedule Tasks
CREATE TABLE IF NOT EXISTS schedule_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(500) NOT NULL,
  description TEXT,
  planned_start_date DATE NOT NULL,
  planned_end_date DATE NOT NULL,
  duration_days INTEGER NOT NULL,
  status VARCHAR(50) DEFAULT 'not_started' CHECK (status IN (
    'not_started', 'in_progress', 'completed', 'on_hold', 'cancelled', 'delayed'
  )),
  priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_schedule_tasks_project ON schedule_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_schedule_tasks_status ON schedule_tasks(status);
CREATE INDEX IF NOT EXISTS idx_schedule_tasks_dates ON schedule_tasks(planned_start_date, planned_end_date);

-- Schedule Milestones
CREATE TABLE IF NOT EXISTS schedule_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(500) NOT NULL,
  description TEXT,
  target_date DATE NOT NULL,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'achieved', 'missed')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_schedule_milestones_project ON schedule_milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_schedule_milestones_status ON schedule_milestones(status);
CREATE INDEX IF NOT EXISTS idx_schedule_milestones_date ON schedule_milestones(target_date);
