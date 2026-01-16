-- ============================================================================
-- BUILDPRO SCHEDULING SYSTEM - COMPREHENSIVE SCHEMA
-- Version: 1.0.0
-- Description: Full-featured project scheduling with tasks, milestones,
--              dependencies, critical path, and baseline tracking
-- ============================================================================

-- ============================================================================
-- SCHEDULE TASKS
-- Core table for project tasks/activities
-- ============================================================================
CREATE TABLE schedule_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_task_id UUID REFERENCES schedule_tasks(id) ON DELETE CASCADE,

  -- Task identification
  task_code VARCHAR(50),  -- e.g., "A.1.2" or "FOUND-001"
  name VARCHAR(500) NOT NULL,
  description TEXT,

  -- Scheduling
  planned_start_date DATE NOT NULL,
  planned_end_date DATE NOT NULL,
  actual_start_date DATE,
  actual_end_date DATE,
  duration_days INTEGER NOT NULL,  -- Working days

  -- Progress tracking
  status VARCHAR(50) DEFAULT 'not_started' CHECK (status IN (
    'not_started', 'in_progress', 'completed', 'on_hold', 'cancelled', 'delayed'
  )),
  percent_complete INTEGER DEFAULT 0 CHECK (percent_complete >= 0 AND percent_complete <= 100),

  -- Critical path analysis
  is_critical BOOLEAN DEFAULT false,
  total_float_days INTEGER DEFAULT 0,  -- Total slack/float
  free_float_days INTEGER DEFAULT 0,   -- Free slack

  -- Dates calculated by scheduling engine
  early_start_date DATE,
  early_finish_date DATE,
  late_start_date DATE,
  late_finish_date DATE,

  -- Task properties
  priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  task_type VARCHAR(50) DEFAULT 'task',  -- task, phase, work_package, summary

  -- Constraints (for schedule calculations)
  constraint_type VARCHAR(50) CHECK (constraint_type IN (
    'asap',           -- As Soon As Possible (default)
    'alap',           -- As Late As Possible
    'snet',           -- Start No Earlier Than
    'snlt',           -- Start No Later Than
    'fnet',           -- Finish No Earlier Than
    'fnlt',           -- Finish No Later Than
    'mso',            -- Must Start On
    'mfo'             -- Must Finish On
  )),
  constraint_date DATE,

  -- Work calendar
  work_calendar_id UUID,  -- Future: link to custom calendars

  -- Costs (optional)
  budgeted_cost DECIMAL(15,2),
  actual_cost DECIMAL(15,2),

  -- Metadata
  created_by UUID REFERENCES users(id),
  assigned_to UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Performance indexes
  INDEX idx_schedule_tasks_project (project_id),
  INDEX idx_schedule_tasks_parent (parent_task_id),
  INDEX idx_schedule_tasks_dates (planned_start_date, planned_end_date),
  INDEX idx_schedule_tasks_status (status),
  INDEX idx_schedule_tasks_critical (is_critical)
);

-- ============================================================================
-- TASK DEPENDENCIES
-- Relationships between tasks (predecessors/successors)
-- ============================================================================
CREATE TABLE task_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  predecessor_task_id UUID NOT NULL REFERENCES schedule_tasks(id) ON DELETE CASCADE,
  successor_task_id UUID NOT NULL REFERENCES schedule_tasks(id) ON DELETE CASCADE,

  -- Dependency type
  dependency_type VARCHAR(10) DEFAULT 'FS' CHECK (dependency_type IN (
    'FS',  -- Finish-to-Start (most common)
    'SS',  -- Start-to-Start
    'FF',  -- Finish-to-Finish
    'SF'   -- Start-to-Finish (rare)
  )),

  -- Lag time (positive = delay, negative = lead time)
  lag_days INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),

  -- Prevent circular dependencies at application level
  CONSTRAINT no_self_dependency CHECK (predecessor_task_id != successor_task_id),

  -- Performance indexes
  INDEX idx_task_dependencies_predecessor (predecessor_task_id),
  INDEX idx_task_dependencies_successor (successor_task_id)
);

-- ============================================================================
-- SCHEDULE MILESTONES
-- Key project milestones and deliverables
-- ============================================================================
CREATE TABLE schedule_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Milestone identification
  name VARCHAR(500) NOT NULL,
  description TEXT,

  -- Milestone type
  milestone_type VARCHAR(50) DEFAULT 'project' CHECK (milestone_type IN (
    'project',      -- Project milestone
    'deliverable',  -- Deliverable
    'phase',        -- Phase completion
    'payment',      -- Payment milestone
    'inspection',   -- Inspection/approval
    'regulatory'    -- Regulatory/permit
  )),

  -- Dates
  target_date DATE NOT NULL,
  forecast_date DATE,
  actual_date DATE,

  -- Status
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN (
    'pending', 'on_track', 'at_risk', 'achieved', 'missed'
  )),

  -- Properties
  is_critical BOOLEAN DEFAULT false,
  is_baseline BOOLEAN DEFAULT false,  -- Is this from original baseline?

  -- Related entities
  related_task_id UUID REFERENCES schedule_tasks(id) ON DELETE SET NULL,

  -- Metadata
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Performance indexes
  INDEX idx_milestones_project (project_id),
  INDEX idx_milestones_date (target_date),
  INDEX idx_milestones_status (status)
);

-- ============================================================================
-- TASK ASSIGNMENTS
-- Resource allocation to tasks
-- ============================================================================
CREATE TABLE task_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES schedule_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Assignment details
  role VARCHAR(100),  -- e.g., "Lead Carpenter", "Electrician"
  allocation_percent INTEGER DEFAULT 100 CHECK (allocation_percent > 0 AND allocation_percent <= 100),

  -- Dates
  assigned_from DATE,
  assigned_to DATE,

  -- Metadata
  assigned_by UUID REFERENCES users(id),
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Prevent duplicate assignments
  UNIQUE(task_id, user_id),

  -- Performance indexes
  INDEX idx_task_assignments_task (task_id),
  INDEX idx_task_assignments_user (user_id)
);

-- ============================================================================
-- SCHEDULE BASELINES
-- Snapshots of the schedule for comparison (original plan vs current)
-- ============================================================================
CREATE TABLE schedule_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Baseline identification
  name VARCHAR(200) NOT NULL,
  description TEXT,
  baseline_type VARCHAR(50) DEFAULT 'approved' CHECK (baseline_type IN (
    'original',   -- Original approved schedule
    'approved',   -- Re-baselined approved schedule
    'what_if',    -- What-if scenario
    'forecast'    -- Current forecast
  )),

  -- Dates
  baseline_date DATE NOT NULL,
  start_date DATE NOT NULL,
  finish_date DATE NOT NULL,

  -- Status
  is_active BOOLEAN DEFAULT false,  -- Only one active baseline per project

  -- Snapshot data (JSON)
  task_snapshot JSONB,  -- Snapshot of all tasks at baseline time

  -- Metadata
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Performance indexes
  INDEX idx_baselines_project (project_id),
  INDEX idx_baselines_active (project_id, is_active) WHERE is_active = true
);

-- ============================================================================
-- WORK CALENDARS
-- Define working days and holidays for schedule calculations
-- ============================================================================
CREATE TABLE work_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,

  -- Calendar identification
  name VARCHAR(200) NOT NULL,
  description TEXT,

  -- Default working days (0 = Sunday, 6 = Saturday)
  working_days INTEGER[] DEFAULT ARRAY[1,2,3,4,5],  -- Monday-Friday

  -- Standard work hours
  hours_per_day DECIMAL(4,2) DEFAULT 8.0,

  -- Is this the default calendar for the project?
  is_default BOOLEAN DEFAULT false,

  -- Metadata
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Performance indexes
  INDEX idx_work_calendars_project (project_id)
);

-- ============================================================================
-- CALENDAR EXCEPTIONS
-- Holidays and special non-working days
-- ============================================================================
CREATE TABLE calendar_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id UUID NOT NULL REFERENCES work_calendars(id) ON DELETE CASCADE,

  -- Exception date
  exception_date DATE NOT NULL,

  -- Is this a working or non-working day?
  is_working BOOLEAN DEFAULT false,

  -- Description
  name VARCHAR(200),  -- e.g., "Christmas", "Company Holiday"

  -- Hours if working day
  hours DECIMAL(4,2),

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Prevent duplicate exceptions
  UNIQUE(calendar_id, exception_date),

  -- Performance indexes
  INDEX idx_calendar_exceptions_calendar (calendar_id),
  INDEX idx_calendar_exceptions_date (exception_date)
);

-- ============================================================================
-- TASK NOTES/COMMENTS
-- Discussion threads on tasks
-- ============================================================================
CREATE TABLE task_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES schedule_tasks(id) ON DELETE CASCADE,

  -- Note content
  content TEXT NOT NULL,

  -- Metadata
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Performance indexes
  INDEX idx_task_notes_task (task_id),
  INDEX idx_task_notes_created (created_at)
);

-- ============================================================================
-- SCHEDULE INTEGRATION LINKS
-- Link schedule tasks to other entities (RFIs, submittals, etc.)
-- ============================================================================
CREATE TABLE schedule_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES schedule_tasks(id) ON DELETE CASCADE,

  -- Linked entity
  entity_type VARCHAR(50) NOT NULL,  -- 'rfi', 'submittal', 'punch_item', 'document'
  entity_id UUID NOT NULL,

  -- Link type
  link_type VARCHAR(50) DEFAULT 'blocks' CHECK (link_type IN (
    'blocks',      -- Entity blocks task completion
    'requires',    -- Task requires entity to be complete
    'related',     -- General relationship
    'impacts'      -- Entity impacts schedule
  )),

  -- Impact on schedule
  schedule_impact_days INTEGER DEFAULT 0,  -- How many days this adds/removes

  -- Metadata
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Performance indexes
  INDEX idx_schedule_links_task (task_id),
  INDEX idx_schedule_links_entity (entity_type, entity_id)
);

-- ============================================================================
-- SCHEDULE AUDIT LOG
-- Track all schedule changes for accountability
-- ============================================================================
CREATE TABLE schedule_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id UUID REFERENCES schedule_tasks(id) ON DELETE SET NULL,

  -- Change details
  change_type VARCHAR(50) NOT NULL,  -- 'task_created', 'dates_changed', 'status_changed', etc.
  field_changed VARCHAR(100),
  old_value TEXT,
  new_value TEXT,

  -- Context
  reason TEXT,

  -- Metadata
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Performance indexes
  INDEX idx_schedule_audit_project (project_id),
  INDEX idx_schedule_audit_task (task_id),
  INDEX idx_schedule_audit_date (changed_at)
);

-- ============================================================================
-- COMMENTS AND INDEXES
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
-- SAMPLE DATA (Optional - for development/testing)
-- ============================================================================

-- Create default work calendar template
INSERT INTO work_calendars (name, description, working_days, hours_per_day, is_default)
VALUES (
  'Standard 5-Day Week',
  'Monday through Friday, 8 hours per day',
  ARRAY[1,2,3,4,5],
  8.0,
  true
);

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
