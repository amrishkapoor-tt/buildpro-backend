-- ============================================================================
-- BUILDPRO SCHEDULING SYSTEM - FIXED VERSION
-- Version: 1.0.1
-- Description: Full-featured project scheduling with tasks, milestones,
--              dependencies, critical path, and baseline tracking
-- ============================================================================

-- ============================================================================
-- SCHEDULE TASKS
-- ============================================================================
CREATE TABLE schedule_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_task_id UUID REFERENCES schedule_tasks(id) ON DELETE CASCADE,
  task_code VARCHAR(50),
  name VARCHAR(500) NOT NULL,
  description TEXT,
  planned_start_date DATE NOT NULL,
  planned_end_date DATE NOT NULL,
  actual_start_date DATE,
  actual_end_date DATE,
  duration_days INTEGER NOT NULL,
  status VARCHAR(50) DEFAULT 'not_started' CHECK (status IN (
    'not_started', 'in_progress', 'completed', 'on_hold', 'cancelled', 'delayed'
  )),
  percent_complete INTEGER DEFAULT 0 CHECK (percent_complete >= 0 AND percent_complete <= 100),
  is_critical BOOLEAN DEFAULT false,
  total_float_days INTEGER DEFAULT 0,
  free_float_days INTEGER DEFAULT 0,
  early_start_date DATE,
  early_finish_date DATE,
  late_start_date DATE,
  late_finish_date DATE,
  priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  task_type VARCHAR(50) DEFAULT 'task',
  constraint_type VARCHAR(50) CHECK (constraint_type IN (
    'asap', 'alap', 'snet', 'snlt', 'fnet', 'fnlt', 'mso', 'mfo'
  )),
  constraint_date DATE,
  work_calendar_id UUID,
  budgeted_cost DECIMAL(15,2),
  actual_cost DECIMAL(15,2),
  created_by UUID REFERENCES users(id),
  assigned_to UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_schedule_tasks_project ON schedule_tasks(project_id);
CREATE INDEX idx_schedule_tasks_parent ON schedule_tasks(parent_task_id);
CREATE INDEX idx_schedule_tasks_dates ON schedule_tasks(planned_start_date, planned_end_date);
CREATE INDEX idx_schedule_tasks_status ON schedule_tasks(status);
CREATE INDEX idx_schedule_tasks_critical ON schedule_tasks(is_critical);

-- ============================================================================
-- TASK DEPENDENCIES
-- ============================================================================
CREATE TABLE task_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  predecessor_task_id UUID NOT NULL REFERENCES schedule_tasks(id) ON DELETE CASCADE,
  successor_task_id UUID NOT NULL REFERENCES schedule_tasks(id) ON DELETE CASCADE,
  dependency_type VARCHAR(10) DEFAULT 'FS' CHECK (dependency_type IN ('FS', 'SS', 'FF', 'SF')),
  lag_days INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  CONSTRAINT no_self_dependency CHECK (predecessor_task_id != successor_task_id)
);

CREATE INDEX idx_task_dependencies_predecessor ON task_dependencies(predecessor_task_id);
CREATE INDEX idx_task_dependencies_successor ON task_dependencies(successor_task_id);

-- ============================================================================
-- SCHEDULE MILESTONES
-- ============================================================================
CREATE TABLE schedule_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(500) NOT NULL,
  description TEXT,
  milestone_type VARCHAR(50) DEFAULT 'project' CHECK (milestone_type IN (
    'project', 'deliverable', 'phase', 'payment', 'inspection', 'regulatory'
  )),
  target_date DATE NOT NULL,
  forecast_date DATE,
  actual_date DATE,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN (
    'pending', 'on_track', 'at_risk', 'achieved', 'missed'
  )),
  is_critical BOOLEAN DEFAULT false,
  is_baseline BOOLEAN DEFAULT false,
  related_task_id UUID REFERENCES schedule_tasks(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_milestones_project ON schedule_milestones(project_id);
CREATE INDEX idx_milestones_date ON schedule_milestones(target_date);
CREATE INDEX idx_milestones_status ON schedule_milestones(status);

-- ============================================================================
-- TASK ASSIGNMENTS
-- ============================================================================
CREATE TABLE task_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES schedule_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(100),
  allocation_percent INTEGER DEFAULT 100 CHECK (allocation_percent > 0 AND allocation_percent <= 100),
  assigned_from DATE,
  assigned_to DATE,
  assigned_by UUID REFERENCES users(id),
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(task_id, user_id)
);

CREATE INDEX idx_task_assignments_task ON task_assignments(task_id);
CREATE INDEX idx_task_assignments_user ON task_assignments(user_id);

-- ============================================================================
-- SCHEDULE BASELINES
-- ============================================================================
CREATE TABLE schedule_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  baseline_type VARCHAR(50) DEFAULT 'approved' CHECK (baseline_type IN (
    'original', 'approved', 'what_if', 'forecast'
  )),
  baseline_date DATE NOT NULL,
  start_date DATE NOT NULL,
  finish_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT false,
  task_snapshot JSONB,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_baselines_project ON schedule_baselines(project_id);
CREATE INDEX idx_baselines_active ON schedule_baselines(project_id, is_active) WHERE is_active = true;

-- ============================================================================
-- WORK CALENDARS
-- ============================================================================
CREATE TABLE work_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  working_days INTEGER[] DEFAULT ARRAY[1,2,3,4,5],
  hours_per_day DECIMAL(4,2) DEFAULT 8.0,
  is_default BOOLEAN DEFAULT false,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_work_calendars_project ON work_calendars(project_id);

-- ============================================================================
-- CALENDAR EXCEPTIONS
-- ============================================================================
CREATE TABLE calendar_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id UUID NOT NULL REFERENCES work_calendars(id) ON DELETE CASCADE,
  exception_date DATE NOT NULL,
  is_working BOOLEAN DEFAULT false,
  name VARCHAR(200),
  hours DECIMAL(4,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(calendar_id, exception_date)
);

CREATE INDEX idx_calendar_exceptions_calendar ON calendar_exceptions(calendar_id);
CREATE INDEX idx_calendar_exceptions_date ON calendar_exceptions(exception_date);

-- ============================================================================
-- TASK NOTES
-- ============================================================================
CREATE TABLE task_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES schedule_tasks(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_task_notes_task ON task_notes(task_id);
CREATE INDEX idx_task_notes_created ON task_notes(created_at);

-- ============================================================================
-- SCHEDULE LINKS
-- ============================================================================
CREATE TABLE schedule_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES schedule_tasks(id) ON DELETE CASCADE,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  link_type VARCHAR(50) DEFAULT 'blocks' CHECK (link_type IN (
    'blocks', 'requires', 'related', 'impacts'
  )),
  schedule_impact_days INTEGER DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_schedule_links_task ON schedule_links(task_id);
CREATE INDEX idx_schedule_links_entity ON schedule_links(entity_type, entity_id);

-- ============================================================================
-- SCHEDULE AUDIT LOG
-- ============================================================================
CREATE TABLE schedule_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id UUID REFERENCES schedule_tasks(id) ON DELETE SET NULL,
  change_type VARCHAR(50) NOT NULL,
  field_changed VARCHAR(100),
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_schedule_audit_project ON schedule_audit_log(project_id);
CREATE INDEX idx_schedule_audit_task ON schedule_audit_log(task_id);
CREATE INDEX idx_schedule_audit_date ON schedule_audit_log(changed_at);

-- ============================================================================
-- TABLE COMMENTS
-- ============================================================================
COMMENT ON TABLE schedule_tasks IS 'Project tasks and activities with scheduling information';
COMMENT ON TABLE task_dependencies IS 'Task relationships (predecessor/successor dependencies)';
COMMENT ON TABLE schedule_milestones IS 'Key project milestones and deliverables';
COMMENT ON TABLE task_assignments IS 'Resource allocation - assign team members to tasks';
COMMENT ON TABLE schedule_baselines IS 'Schedule snapshots for variance analysis';
COMMENT ON TABLE work_calendars IS 'Working days and hours for schedule calculations';
COMMENT ON TABLE calendar_exceptions IS 'Holidays and non-working days';
COMMENT ON TABLE schedule_links IS 'Link tasks to RFIs, submittals, punch items, etc.';

-- ============================================================================
-- DEFAULT DATA
-- ============================================================================
INSERT INTO work_calendars (name, description, working_days, hours_per_day, is_default)
VALUES (
  'Standard 5-Day Week',
  'Monday through Friday, 8 hours per day',
  ARRAY[1,2,3,4,5],
  8.0,
  true
)
ON CONFLICT DO NOTHING;
