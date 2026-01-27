-- ============================================================================
-- WORKFLOW ENGINE MIGRATION
-- Version: 1.0
-- Purpose: Implement configurable workflow engine for FreeCore
-- ============================================================================

BEGIN;

-- ============================================================================
-- PHASE 1: WORKFLOW TEMPLATE TABLES
-- ============================================================================

-- Table: workflow_templates
-- Define reusable workflow patterns
CREATE TABLE IF NOT EXISTS workflow_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    entity_type VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    is_default BOOLEAN DEFAULT false,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(entity_type, name)
);

CREATE INDEX idx_workflow_templates_entity ON workflow_templates(entity_type);
CREATE INDEX idx_workflow_templates_active ON workflow_templates(is_active) WHERE is_active = true;
CREATE INDEX idx_workflow_templates_default ON workflow_templates(entity_type, is_default) WHERE is_default = true;

COMMENT ON TABLE workflow_templates IS 'Defines reusable workflow patterns for different entity types';
COMMENT ON COLUMN workflow_templates.entity_type IS 'Entity this workflow applies to: submittal, rfi, change_order, drawing, etc.';
COMMENT ON COLUMN workflow_templates.is_default IS 'Default workflow template for this entity type';

-- ============================================================================
-- PHASE 2: WORKFLOW STAGES
-- ============================================================================

-- Table: workflow_stages
-- Define stages/steps within a workflow
CREATE TABLE IF NOT EXISTS workflow_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_template_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
    stage_number INTEGER NOT NULL,
    stage_name VARCHAR(100) NOT NULL,
    stage_type VARCHAR(50) NOT NULL CHECK (stage_type IN ('approval', 'review', 'notification', 'action')),
    requires_approval BOOLEAN DEFAULT true,
    approval_type VARCHAR(50) DEFAULT 'any' CHECK (approval_type IN ('any', 'all', 'majority')),

    -- SLA Settings
    sla_hours INTEGER,
    escalation_hours INTEGER,

    -- Assignment Rules (JSON for flexibility)
    assignment_rules JSONB DEFAULT '{}',

    -- Actions to perform at this stage
    actions JSONB DEFAULT '[]',

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(workflow_template_id, stage_number),
    CHECK (stage_number > 0),
    CHECK (escalation_hours IS NULL OR escalation_hours >= sla_hours)
);

CREATE INDEX idx_workflow_stages_template ON workflow_stages(workflow_template_id);
CREATE INDEX idx_workflow_stages_number ON workflow_stages(workflow_template_id, stage_number);

COMMENT ON TABLE workflow_stages IS 'Defines stages within a workflow template';
COMMENT ON COLUMN workflow_stages.stage_type IS 'Type of stage: approval (requires decision), review (informational), notification (alert only), action (automated)';
COMMENT ON COLUMN workflow_stages.approval_type IS 'For parallel approvals: any (one approver), all (unanimous), majority (>50%)';
COMMENT ON COLUMN workflow_stages.assignment_rules IS 'JSON rules for assigning users: {"type":"role","role":"architect"} or {"type":"user","user_id":"uuid"}';
COMMENT ON COLUMN workflow_stages.actions IS 'JSON array of actions: [{"type":"send_notification","template":"review_request"}]';

-- ============================================================================
-- PHASE 3: WORKFLOW TRANSITIONS
-- ============================================================================

-- Table: workflow_transitions
-- Define allowed transitions between stages with conditions
CREATE TABLE IF NOT EXISTS workflow_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_template_id UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
    from_stage_id UUID REFERENCES workflow_stages(id) ON DELETE CASCADE,
    to_stage_id UUID REFERENCES workflow_stages(id) ON DELETE CASCADE,

    -- Transition metadata
    transition_name VARCHAR(100),
    transition_action VARCHAR(50) NOT NULL CHECK (transition_action IN ('approve', 'reject', 'revise', 'skip', 'complete', 'request_changes')),

    -- Conditions for this transition (JSON for flexibility)
    conditions JSONB DEFAULT '{}',

    -- Auto-transition settings
    is_automatic BOOLEAN DEFAULT false,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(workflow_template_id, from_stage_id, to_stage_id, transition_action),
    CHECK (from_stage_id IS NOT NULL OR to_stage_id IS NOT NULL)
);

CREATE INDEX idx_workflow_transitions_template ON workflow_transitions(workflow_template_id);
CREATE INDEX idx_workflow_transitions_from ON workflow_transitions(from_stage_id);
CREATE INDEX idx_workflow_transitions_to ON workflow_transitions(to_stage_id);

COMMENT ON TABLE workflow_transitions IS 'Defines allowed transitions between workflow stages';
COMMENT ON COLUMN workflow_transitions.from_stage_id IS 'Source stage (NULL = workflow start)';
COMMENT ON COLUMN workflow_transitions.to_stage_id IS 'Destination stage (NULL = workflow end)';
COMMENT ON COLUMN workflow_transitions.conditions IS 'JSON conditions for transition: {"field":"amount","operator":">","value":50000}';
COMMENT ON COLUMN workflow_transitions.is_automatic IS 'Auto-advance to next stage on completion?';

-- ============================================================================
-- PHASE 4: WORKFLOW INSTANCES
-- ============================================================================

-- Table: workflow_instances
-- Track active workflow execution for each entity
CREATE TABLE IF NOT EXISTS workflow_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_template_id UUID NOT NULL REFERENCES workflow_templates(id),

    -- Entity being processed
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,

    -- Current state
    current_stage_id UUID REFERENCES workflow_stages(id),
    workflow_status VARCHAR(50) DEFAULT 'active' CHECK (workflow_status IN ('active', 'completed', 'rejected', 'cancelled', 'paused')),

    -- Assignment tracking
    assigned_to UUID REFERENCES users(id),
    assigned_at TIMESTAMP WITH TIME ZONE,

    -- SLA tracking
    stage_started_at TIMESTAMP WITH TIME ZONE,
    stage_due_at TIMESTAMP WITH TIME ZONE,
    is_overdue BOOLEAN DEFAULT false,

    -- Metadata
    project_id UUID REFERENCES projects(id),
    started_by UUID REFERENCES users(id),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(entity_type, entity_id)
);

CREATE INDEX idx_workflow_instances_entity ON workflow_instances(entity_type, entity_id);
CREATE INDEX idx_workflow_instances_assignee ON workflow_instances(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_workflow_instances_status ON workflow_instances(workflow_status);
CREATE INDEX idx_workflow_instances_overdue ON workflow_instances(is_overdue) WHERE is_overdue = true;
CREATE INDEX idx_workflow_instances_stage ON workflow_instances(current_stage_id);
CREATE INDEX idx_workflow_instances_project ON workflow_instances(project_id);
CREATE INDEX idx_workflow_instances_active ON workflow_instances(workflow_status, assigned_to) WHERE workflow_status = 'active';

COMMENT ON TABLE workflow_instances IS 'Tracks active workflow execution for each entity';
COMMENT ON COLUMN workflow_instances.entity_type IS 'Type of entity: submittal, rfi, change_order, drawing, etc.';
COMMENT ON COLUMN workflow_instances.entity_id IS 'Foreign key to the actual entity (submittals.id, rfis.id, etc.)';
COMMENT ON COLUMN workflow_instances.is_overdue IS 'Computed column: true if past due date and still active';

-- ============================================================================
-- PHASE 5: WORKFLOW HISTORY
-- ============================================================================

-- Table: workflow_instance_history
-- Complete audit trail of all workflow actions
CREATE TABLE IF NOT EXISTS workflow_instance_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,

    -- Stage transition
    from_stage_id UUID REFERENCES workflow_stages(id),
    to_stage_id UUID REFERENCES workflow_stages(id),
    transition_action VARCHAR(50),

    -- User action
    actor_id UUID REFERENCES users(id),
    action_type VARCHAR(50) NOT NULL CHECK (action_type IN ('transition', 'assign', 'escalate', 'delegate', 'comment', 'cancel', 'pause', 'resume')),

    -- Assignment change
    assigned_from UUID REFERENCES users(id),
    assigned_to UUID REFERENCES users(id),

    -- Metadata
    comments TEXT,
    metadata JSONB DEFAULT '{}',

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_workflow_history_instance ON workflow_instance_history(workflow_instance_id);
CREATE INDEX idx_workflow_history_created ON workflow_instance_history(created_at DESC);
CREATE INDEX idx_workflow_history_actor ON workflow_instance_history(actor_id);
CREATE INDEX idx_workflow_history_action ON workflow_instance_history(action_type);

COMMENT ON TABLE workflow_instance_history IS 'Complete audit trail of all workflow actions';
COMMENT ON COLUMN workflow_instance_history.action_type IS 'Type of action: transition, assign, escalate, delegate, comment, cancel, pause, resume';

-- ============================================================================
-- PHASE 6: WORKFLOW ASSIGNMENTS
-- ============================================================================

-- Table: workflow_assignments
-- Track who can approve at each stage
CREATE TABLE IF NOT EXISTS workflow_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
    stage_id UUID NOT NULL REFERENCES workflow_stages(id),

    -- Assignment details
    assignee_type VARCHAR(50) NOT NULL CHECK (assignee_type IN ('user', 'role', 'auto')),
    assignee_id UUID REFERENCES users(id),
    assignee_role VARCHAR(50),

    -- Status
    assignment_status VARCHAR(50) DEFAULT 'pending' CHECK (assignment_status IN ('pending', 'active', 'completed', 'skipped', 'delegated')),

    -- Response
    responded_at TIMESTAMP WITH TIME ZONE,
    response_action VARCHAR(50),
    response_comments TEXT,

    -- Delegation
    delegated_to UUID REFERENCES users(id),
    delegated_at TIMESTAMP WITH TIME ZONE,
    delegation_reason TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(workflow_instance_id, stage_id, assignee_id)
);

CREATE INDEX idx_workflow_assignments_instance ON workflow_assignments(workflow_instance_id);
CREATE INDEX idx_workflow_assignments_assignee ON workflow_assignments(assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX idx_workflow_assignments_status ON workflow_assignments(assignment_status);
CREATE INDEX idx_workflow_assignments_pending ON workflow_assignments(assignee_id, assignment_status) WHERE assignment_status IN ('pending', 'active');

COMMENT ON TABLE workflow_assignments IS 'Tracks who can approve at each workflow stage';
COMMENT ON COLUMN workflow_assignments.assignee_type IS 'Type: user (specific user), role (any user with role), auto (system action)';

-- ============================================================================
-- PHASE 7: WORKFLOW ESCALATIONS
-- ============================================================================

-- Table: workflow_escalations
-- Track escalation rules and execution
CREATE TABLE IF NOT EXISTS workflow_escalations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
    stage_id UUID NOT NULL REFERENCES workflow_stages(id),

    -- Escalation rule
    escalate_to_user_id UUID REFERENCES users(id),
    escalate_to_role VARCHAR(50),

    -- Trigger conditions
    triggered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    trigger_reason VARCHAR(100) CHECK (trigger_reason IN ('overdue', 'manual', 'no_response', 'sla_violation')),
    hours_overdue INTEGER,

    -- Resolution
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_action VARCHAR(50) CHECK (resolution_action IN ('reassigned', 'approved', 'cancelled', 'completed')),
    resolution_notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_workflow_escalations_instance ON workflow_escalations(workflow_instance_id);
CREATE INDEX idx_workflow_escalations_unresolved ON workflow_escalations(resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX idx_workflow_escalations_triggered ON workflow_escalations(triggered_at DESC);

COMMENT ON TABLE workflow_escalations IS 'Tracks workflow escalations due to overdue tasks or manual triggers';

-- ============================================================================
-- PHASE 8: SLA VIOLATIONS
-- ============================================================================

-- Table: workflow_sla_violations
-- Track SLA violations for reporting
CREATE TABLE IF NOT EXISTS workflow_sla_violations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
    stage_id UUID NOT NULL REFERENCES workflow_stages(id),

    -- Violation details
    due_at TIMESTAMP WITH TIME ZONE NOT NULL,
    violated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    hours_overdue INTEGER,

    -- Assignment at time of violation
    assigned_to UUID REFERENCES users(id),

    -- Resolution
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_workflow_sla_violations_instance ON workflow_sla_violations(workflow_instance_id);
CREATE INDEX idx_workflow_sla_violations_unresolved ON workflow_sla_violations(resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX idx_workflow_sla_violations_violated ON workflow_sla_violations(violated_at DESC);

COMMENT ON TABLE workflow_sla_violations IS 'Tracks SLA violations for reporting and analytics';

-- ============================================================================
-- PHASE 9: ENTITY MAPPING (MIGRATION SUPPORT)
-- ============================================================================

-- Table: workflow_entity_mapping
-- Map existing entity statuses to workflow stages during migration
CREATE TABLE IF NOT EXISTS workflow_entity_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(50) NOT NULL,
    legacy_status VARCHAR(50) NOT NULL,
    workflow_stage_id UUID REFERENCES workflow_stages(id),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(entity_type, legacy_status)
);

CREATE INDEX idx_workflow_entity_mapping_type ON workflow_entity_mapping(entity_type);

COMMENT ON TABLE workflow_entity_mapping IS 'Maps legacy entity statuses to workflow stages for migration';

-- ============================================================================
-- PHASE 10: TRIGGERS
-- ============================================================================

-- Update updated_at timestamps
CREATE OR REPLACE FUNCTION update_workflow_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at columns
CREATE TRIGGER update_workflow_templates_updated_at
    BEFORE UPDATE ON workflow_templates
    FOR EACH ROW EXECUTE FUNCTION update_workflow_updated_at();

CREATE TRIGGER update_workflow_stages_updated_at
    BEFORE UPDATE ON workflow_stages
    FOR EACH ROW EXECUTE FUNCTION update_workflow_updated_at();

CREATE TRIGGER update_workflow_instances_updated_at
    BEFORE UPDATE ON workflow_instances
    FOR EACH ROW EXECUTE FUNCTION update_workflow_updated_at();

CREATE TRIGGER update_workflow_assignments_updated_at
    BEFORE UPDATE ON workflow_assignments
    FOR EACH ROW EXECUTE FUNCTION update_workflow_updated_at();

-- ============================================================================
-- PHASE 11: SEED DATA - DEFAULT WORKFLOW TEMPLATES
-- ============================================================================

-- Submittal Workflow Template
INSERT INTO workflow_templates (name, entity_type, description, is_default)
VALUES (
    'Standard Submittal Review',
    'submittal',
    'GC Review → Architect Review → Engineer Review → Distribution',
    true
) ON CONFLICT (entity_type, name) DO NOTHING;

-- RFI Workflow Template (Low Value)
INSERT INTO workflow_templates (name, entity_type, description, is_default)
VALUES (
    'RFI Response - Standard',
    'rfi',
    'Superintendent → Architect → Response',
    true
) ON CONFLICT (entity_type, name) DO NOTHING;

-- RFI Workflow Template (High Value)
INSERT INTO workflow_templates (name, entity_type, description, is_default)
VALUES (
    'RFI Response - High Value',
    'rfi',
    'Superintendent → PM → Architect → Engineer → Response',
    false
) ON CONFLICT (entity_type, name) DO NOTHING;

-- Change Order Workflow Template
INSERT INTO workflow_templates (name, entity_type, description, is_default)
VALUES (
    'Change Order Approval',
    'change_order',
    'PM → Owner (if >$50k) → Final Approval',
    true
) ON CONFLICT (entity_type, name) DO NOTHING;

-- Drawing Workflow Template
INSERT INTO workflow_templates (name, entity_type, description, is_default)
VALUES (
    'Drawing Review',
    'drawing',
    'Multi-Discipline Review → Coordination → Distribution',
    true
) ON CONFLICT (entity_type, name) DO NOTHING;

-- Punch Item Workflow Template
INSERT INTO workflow_templates (name, entity_type, description, is_default)
VALUES (
    'Punch Item Resolution',
    'punch_item',
    'Assigned → In Progress → Completed → Verified → Closed',
    true
) ON CONFLICT (entity_type, name) DO NOTHING;

-- ============================================================================
-- PHASE 12: SEED DATA - SUBMITTAL WORKFLOW STAGES
-- ============================================================================

DO $$
DECLARE
    template_id UUID;
    stage1_id UUID;
    stage2_id UUID;
    stage3_id UUID;
    stage4_id UUID;
BEGIN
    -- Get submittal template ID
    SELECT id INTO template_id FROM workflow_templates
    WHERE entity_type = 'submittal' AND is_default = true;

    -- Stage 1: GC Review
    INSERT INTO workflow_stages (
        workflow_template_id, stage_number, stage_name, stage_type,
        sla_hours, escalation_hours, assignment_rules, requires_approval
    ) VALUES (
        template_id, 1, 'GC Review', 'review',
        48, 60,
        '{"type": "role", "role": "superintendent"}'::jsonb,
        true
    ) ON CONFLICT (workflow_template_id, stage_number) DO NOTHING
    RETURNING id INTO stage1_id;

    -- Stage 2: Architect Review
    INSERT INTO workflow_stages (
        workflow_template_id, stage_number, stage_name, stage_type,
        sla_hours, escalation_hours, assignment_rules, requires_approval
    ) VALUES (
        template_id, 2, 'Architect Review', 'approval',
        72, 84,
        '{"type": "role", "role": "architect"}'::jsonb,
        true
    ) ON CONFLICT (workflow_template_id, stage_number) DO NOTHING
    RETURNING id INTO stage2_id;

    -- Stage 3: Engineer Review (if needed)
    INSERT INTO workflow_stages (
        workflow_template_id, stage_number, stage_name, stage_type,
        sla_hours, escalation_hours, assignment_rules, requires_approval
    ) VALUES (
        template_id, 3, 'Engineer Review', 'approval',
        72, 84,
        '{"type": "role", "role": "engineer"}'::jsonb,
        true
    ) ON CONFLICT (workflow_template_id, stage_number) DO NOTHING
    RETURNING id INTO stage3_id;

    -- Stage 4: Distribution
    INSERT INTO workflow_stages (
        workflow_template_id, stage_number, stage_name, stage_type,
        sla_hours, assignment_rules, requires_approval
    ) VALUES (
        template_id, 4, 'Distribution', 'action',
        24,
        '{"type": "auto", "action": "distribute"}'::jsonb,
        false
    ) ON CONFLICT (workflow_template_id, stage_number) DO NOTHING
    RETURNING id INTO stage4_id;

    -- Transitions
    IF stage1_id IS NOT NULL AND stage2_id IS NOT NULL THEN
        INSERT INTO workflow_transitions (
            workflow_template_id, from_stage_id, to_stage_id,
            transition_action, transition_name, is_automatic
        ) VALUES (
            template_id, stage1_id, stage2_id,
            'approve', 'Approve & Forward to Architect', true
        ) ON CONFLICT DO NOTHING;

        INSERT INTO workflow_transitions (
            workflow_template_id, from_stage_id, to_stage_id,
            transition_action, transition_name
        ) VALUES (
            template_id, stage1_id, NULL,
            'reject', 'Reject Submittal'
        ) ON CONFLICT DO NOTHING;
    END IF;

    IF stage2_id IS NOT NULL AND stage3_id IS NOT NULL THEN
        INSERT INTO workflow_transitions (
            workflow_template_id, from_stage_id, to_stage_id,
            transition_action, transition_name, is_automatic
        ) VALUES (
            template_id, stage2_id, stage3_id,
            'approve', 'Approve & Forward to Engineer', true
        ) ON CONFLICT DO NOTHING;

        INSERT INTO workflow_transitions (
            workflow_template_id, from_stage_id, to_stage_id,
            transition_action, transition_name
        ) VALUES (
            template_id, stage2_id, stage1_id,
            'revise', 'Request Revisions'
        ) ON CONFLICT DO NOTHING;
    END IF;

    IF stage3_id IS NOT NULL AND stage4_id IS NOT NULL THEN
        INSERT INTO workflow_transitions (
            workflow_template_id, from_stage_id, to_stage_id,
            transition_action, transition_name, is_automatic
        ) VALUES (
            template_id, stage3_id, stage4_id,
            'approve', 'Approve & Distribute', true
        ) ON CONFLICT DO NOTHING;
    END IF;
END $$;

-- ============================================================================
-- PHASE 13: HELPER VIEWS
-- ============================================================================

-- View: active_workflow_tasks
-- Shows all active tasks assigned to users
CREATE OR REPLACE VIEW active_workflow_tasks AS
SELECT
    wi.id AS workflow_instance_id,
    wi.entity_type,
    wi.entity_id,
    wi.project_id,
    ws.stage_name AS current_stage,
    wi.assigned_to AS assignee_id,
    CONCAT(u.first_name, ' ', u.last_name) AS assignee_name,
    u.email AS assignee_email,
    wi.stage_started_at,
    wi.stage_due_at,
    wi.is_overdue,
    CASE
        WHEN wi.is_overdue THEN 'overdue'
        WHEN wi.stage_due_at < CURRENT_TIMESTAMP + INTERVAL '24 hours' THEN 'due_soon'
        ELSE 'on_track'
    END AS urgency,
    p.name AS project_name,
    wt.name AS workflow_template_name
FROM workflow_instances wi
INNER JOIN workflow_stages ws ON ws.id = wi.current_stage_id
INNER JOIN workflow_templates wt ON wt.id = wi.workflow_template_id
LEFT JOIN users u ON u.id = wi.assigned_to
LEFT JOIN projects p ON p.id = wi.project_id
WHERE wi.workflow_status = 'active';

COMMENT ON VIEW active_workflow_tasks IS 'Shows all active workflow tasks with assignee and urgency information';

-- View: workflow_performance_metrics
-- Analytics view for workflow performance
CREATE OR REPLACE VIEW workflow_performance_metrics AS
SELECT
    wt.entity_type,
    wt.name AS workflow_template_name,
    COUNT(*) AS total_workflows,
    COUNT(*) FILTER (WHERE wi.workflow_status = 'active') AS active_count,
    COUNT(*) FILTER (WHERE wi.workflow_status = 'completed') AS completed_count,
    COUNT(*) FILTER (WHERE wi.is_overdue) AS overdue_count,
    AVG(EXTRACT(EPOCH FROM (wi.completed_at - wi.started_at)) / 3600) FILTER (WHERE wi.workflow_status = 'completed') AS avg_completion_hours,
    COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM workflow_sla_violations wsv WHERE wsv.workflow_instance_id = wi.id
    )) AS sla_violation_count
FROM workflow_instances wi
INNER JOIN workflow_templates wt ON wt.id = wi.workflow_template_id
GROUP BY wt.entity_type, wt.name;

COMMENT ON VIEW workflow_performance_metrics IS 'Performance metrics for workflow templates';

-- ============================================================================
-- PHASE 14: HELPER FUNCTIONS
-- ============================================================================

-- Function: get_workflow_for_entity
-- Gets active workflow instance for an entity
CREATE OR REPLACE FUNCTION get_workflow_for_entity(
    p_entity_type VARCHAR(50),
    p_entity_id UUID
) RETURNS TABLE (
    workflow_instance_id UUID,
    current_stage_name VARCHAR(100),
    assigned_to_id UUID,
    is_overdue BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        wi.id,
        ws.stage_name,
        wi.assigned_to,
        wi.is_overdue
    FROM workflow_instances wi
    INNER JOIN workflow_stages ws ON ws.id = wi.current_stage_id
    WHERE wi.entity_type = p_entity_type
      AND wi.entity_id = p_entity_id
      AND wi.workflow_status = 'active';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_workflow_for_entity IS 'Returns active workflow instance for a given entity';

-- Function: get_user_pending_tasks_count
-- Gets count of pending tasks for a user
CREATE OR REPLACE FUNCTION get_user_pending_tasks_count(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    task_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO task_count
    FROM workflow_instances
    WHERE assigned_to = p_user_id
      AND workflow_status = 'active';

    RETURN task_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_user_pending_tasks_count IS 'Returns count of active workflow tasks assigned to user';

COMMIT;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Verification queries:
-- SELECT COUNT(*) FROM workflow_templates;
-- SELECT COUNT(*) FROM workflow_stages;
-- SELECT COUNT(*) FROM workflow_transitions;
-- SELECT * FROM active_workflow_tasks LIMIT 10;
