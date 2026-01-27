-- ============================================================================
-- HOTFIX: Add project_id to active_workflow_tasks view
-- Purpose: Fix missing project_id column in view that causes 500 errors
-- ============================================================================

-- Drop and recreate the view with project_id column
DROP VIEW IF EXISTS active_workflow_tasks;

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
