// ============================================================================
// WORKFLOW ENGINE API ENDPOINTS
// RESTful API for workflow engine operations
// ============================================================================

const WorkflowManager = require('./WorkflowManager');
const ActionExecutor = require('./ActionExecutor');

/**
 * Register workflow API routes
 * @param {Express} app - Express app instance
 * @param {Pool} pool - PostgreSQL connection pool
 * @param {Function} authenticateToken - Authentication middleware
 */
function registerWorkflowRoutes(app, pool, authenticateToken) {
  const workflowManager = new WorkflowManager(pool);
  const actionExecutor = new ActionExecutor(pool);

  // ==========================================================================
  // START WORKFLOW
  // POST /api/v1/workflows/start
  // ==========================================================================

  app.post('/api/v1/workflows/start', authenticateToken, async (req, res) => {
    try {
      const { entity_type, entity_id, project_id } = req.body;

      if (!entity_type || !entity_id) {
        return res.status(400).json({
          error: 'entity_type and entity_id are required'
        });
      }

      const workflow = await workflowManager.startWorkflow(
        entity_type,
        entity_id,
        project_id,
        req.user.userId
      );

      res.status(201).json({
        success: true,
        workflow
      });

    } catch (error) {
      console.error('Error starting workflow:', error);

      if (error.message.includes('already exists')) {
        return res.status(409).json({ error: error.message });
      }

      res.status(500).json({
        error: 'Failed to start workflow',
        details: error.message
      });
    }
  });

  // ==========================================================================
  // GET WORKFLOW FOR ENTITY
  // GET /api/v1/workflows/entity/:entityType/:entityId
  // ==========================================================================

  app.get('/api/v1/workflows/entity/:entityType/:entityId', authenticateToken, async (req, res) => {
    try {
      const { entityType, entityId } = req.params;

      const workflow = await workflowManager.getWorkflowForEntity(entityType, entityId);

      if (!workflow) {
        return res.status(404).json({
          error: 'No workflow found for this entity'
        });
      }

      res.json({
        success: true,
        workflow
      });

    } catch (error) {
      console.error('Error getting workflow:', error);
      res.status(500).json({
        error: 'Failed to retrieve workflow',
        details: error.message
      });
    }
  });

  // ==========================================================================
  // GET WORKFLOW BY ID
  // GET /api/v1/workflows/:workflowId
  // ==========================================================================

  app.get('/api/v1/workflows/:workflowId', authenticateToken, async (req, res) => {
    try {
      const { workflowId } = req.params;

      const workflow = await workflowManager.getWorkflow(workflowId);

      res.json({
        success: true,
        workflow
      });

    } catch (error) {
      console.error('Error getting workflow:', error);

      if (error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }

      res.status(500).json({
        error: 'Failed to retrieve workflow',
        details: error.message
      });
    }
  });

  // ==========================================================================
  // GET WORKFLOW HISTORY
  // GET /api/v1/workflows/:workflowId/history
  // ==========================================================================

  app.get('/api/v1/workflows/:workflowId/history', authenticateToken, async (req, res) => {
    try {
      const { workflowId } = req.params;

      const history = await workflowManager.getWorkflowHistory(workflowId);

      res.json({
        success: true,
        history
      });

    } catch (error) {
      console.error('Error getting workflow history:', error);
      res.status(500).json({
        error: 'Failed to retrieve workflow history',
        details: error.message
      });
    }
  });

  // ==========================================================================
  // TRANSITION WORKFLOW
  // POST /api/v1/workflows/:workflowId/transition
  // ==========================================================================

  app.post('/api/v1/workflows/:workflowId/transition', authenticateToken, async (req, res) => {
    try {
      const { workflowId } = req.params;
      const { transition_action, comments } = req.body;

      if (!transition_action) {
        return res.status(400).json({
          error: 'transition_action is required'
        });
      }

      const workflow = await workflowManager.transitionWorkflow(
        workflowId,
        transition_action,
        req.user.userId,
        comments
      );

      res.json({
        success: true,
        message: `Workflow transitioned: ${transition_action}`,
        workflow
      });

    } catch (error) {
      console.error('Error transitioning workflow:', error);

      if (error.message.includes('not found') || error.message.includes('Cannot transition')) {
        return res.status(400).json({ error: error.message });
      }

      if (error.message.includes('Invalid transition')) {
        return res.status(422).json({ error: error.message });
      }

      res.status(500).json({
        error: 'Failed to transition workflow',
        details: error.message
      });
    }
  });

  // ==========================================================================
  // GET USER TASKS
  // GET /api/v1/workflows/tasks/my-tasks
  // ==========================================================================

  app.get('/api/v1/workflows/tasks/my-tasks', authenticateToken, async (req, res) => {
    try {
      const { project_id, entity_type } = req.query;

      const filters = {};
      if (project_id) filters.projectId = project_id;
      if (entity_type) filters.entityType = entity_type;

      const tasks = await workflowManager.getUserTasks(req.user.userId, filters);

      res.json({
        success: true,
        count: tasks.length,
        tasks
      });

    } catch (error) {
      console.error('Error getting user tasks:', error);
      res.status(500).json({
        error: 'Failed to retrieve tasks',
        details: error.message
      });
    }
  });

  // ==========================================================================
  // GET PROJECT WORKFLOWS
  // GET /api/v1/workflows/project/:projectId
  // ==========================================================================

  app.get('/api/v1/workflows/project/:projectId', authenticateToken, async (req, res) => {
    try {
      const { projectId } = req.params;
      const { entity_type, status } = req.query;

      const filters = {};
      if (entity_type) filters.entityType = entity_type;
      if (status) filters.status = status;

      const workflows = await workflowManager.getProjectWorkflows(projectId, filters);

      res.json({
        success: true,
        count: workflows.length,
        workflows
      });

    } catch (error) {
      console.error('Error getting project workflows:', error);
      res.status(500).json({
        error: 'Failed to retrieve workflows',
        details: error.message
      });
    }
  });

  // ==========================================================================
  // CANCEL WORKFLOW
  // POST /api/v1/workflows/:workflowId/cancel
  // ==========================================================================

  app.post('/api/v1/workflows/:workflowId/cancel', authenticateToken, async (req, res) => {
    try {
      const { workflowId } = req.params;
      const { reason } = req.body;

      if (!reason) {
        return res.status(400).json({
          error: 'reason is required'
        });
      }

      const workflow = await workflowManager.cancelWorkflow(
        workflowId,
        req.user.userId,
        reason
      );

      res.json({
        success: true,
        message: 'Workflow cancelled',
        workflow
      });

    } catch (error) {
      console.error('Error cancelling workflow:', error);
      res.status(500).json({
        error: 'Failed to cancel workflow',
        details: error.message
      });
    }
  });

  // ==========================================================================
  // GET AVAILABLE TRANSITIONS
  // GET /api/v1/workflows/:workflowId/transitions
  // ==========================================================================

  app.get('/api/v1/workflows/:workflowId/transitions', authenticateToken, async (req, res) => {
    try {
      const { workflowId } = req.params;

      // Get workflow
      const workflow = await workflowManager.getWorkflow(workflowId);

      // Get available transitions from current stage
      const transitionsResult = await pool.query(
        `SELECT
          wt.*,
          ws_to.stage_name AS to_stage_name,
          ws_to.stage_number AS to_stage_number
         FROM workflow_transitions wt
         LEFT JOIN workflow_stages ws_to ON ws_to.id = wt.to_stage_id
         WHERE wt.workflow_template_id = $1
           AND wt.from_stage_id = $2
         ORDER BY
           CASE wt.transition_action
             WHEN 'approve' THEN 1
             WHEN 'revise' THEN 2
             WHEN 'reject' THEN 3
             ELSE 4
           END`,
        [workflow.workflow_template_id, workflow.current_stage_id]
      );

      res.json({
        success: true,
        transitions: transitionsResult.rows
      });

    } catch (error) {
      console.error('Error getting available transitions:', error);
      res.status(500).json({
        error: 'Failed to retrieve transitions',
        details: error.message
      });
    }
  });

  // ==========================================================================
  // GET WORKFLOW TEMPLATES
  // GET /api/v1/workflows/templates
  // ==========================================================================

  app.get('/api/v1/workflows/templates', authenticateToken, async (req, res) => {
    try {
      const { entity_type } = req.query;

      let query = `
        SELECT
          wt.*,
          COUNT(DISTINCT ws.id) AS stage_count,
          COUNT(DISTINCT wtr.id) AS transition_count
        FROM workflow_templates wt
        LEFT JOIN workflow_stages ws ON ws.workflow_template_id = wt.id
        LEFT JOIN workflow_transitions wtr ON wtr.workflow_template_id = wt.id
        WHERE wt.is_active = true
      `;

      const params = [];

      if (entity_type) {
        query += ` AND wt.entity_type = $1`;
        params.push(entity_type);
      }

      query += `
        GROUP BY wt.id
        ORDER BY wt.entity_type, wt.is_default DESC, wt.name
      `;

      const result = await pool.query(query, params);

      res.json({
        success: true,
        templates: result.rows
      });

    } catch (error) {
      console.error('Error getting workflow templates:', error);
      res.status(500).json({
        error: 'Failed to retrieve templates',
        details: error.message
      });
    }
  });

  // ==========================================================================
  // GET WORKFLOW TEMPLATE DETAILS
  // GET /api/v1/workflows/templates/:templateId
  // ==========================================================================

  app.get('/api/v1/workflows/templates/:templateId', authenticateToken, async (req, res) => {
    try {
      const { templateId } = req.params;

      // Get template
      const templateResult = await pool.query(
        `SELECT * FROM workflow_templates WHERE id = $1`,
        [templateId]
      );

      if (templateResult.rows.length === 0) {
        return res.status(404).json({ error: 'Template not found' });
      }

      const template = templateResult.rows[0];

      // Get stages
      const stagesResult = await pool.query(
        `SELECT * FROM workflow_stages WHERE workflow_template_id = $1 ORDER BY stage_number`,
        [templateId]
      );

      // Get transitions
      const transitionsResult = await pool.query(
        `SELECT
          wt.*,
          ws_from.stage_name AS from_stage_name,
          ws_to.stage_name AS to_stage_name
         FROM workflow_transitions wt
         LEFT JOIN workflow_stages ws_from ON ws_from.id = wt.from_stage_id
         LEFT JOIN workflow_stages ws_to ON ws_to.id = wt.to_stage_id
         WHERE wt.workflow_template_id = $1
         ORDER BY ws_from.stage_number NULLS FIRST`,
        [templateId]
      );

      res.json({
        success: true,
        template: {
          ...template,
          stages: stagesResult.rows,
          transitions: transitionsResult.rows
        }
      });

    } catch (error) {
      console.error('Error getting template details:', error);
      res.status(500).json({
        error: 'Failed to retrieve template details',
        details: error.message
      });
    }
  });

  // ==========================================================================
  // GET WORKFLOW STATISTICS
  // GET /api/v1/workflows/stats/project/:projectId
  // ==========================================================================

  app.get('/api/v1/workflows/stats/project/:projectId', authenticateToken, async (req, res) => {
    try {
      const { projectId } = req.params;

      const statsResult = await pool.query(
        `SELECT
          COUNT(*) AS total_workflows,
          COUNT(*) FILTER (WHERE workflow_status = 'active') AS active,
          COUNT(*) FILTER (WHERE workflow_status = 'completed') AS completed,
          COUNT(*) FILTER (WHERE workflow_status = 'rejected') AS rejected,
          COUNT(*) FILTER (WHERE is_overdue = true) AS overdue,
          entity_type,
          COUNT(DISTINCT assigned_to) AS unique_assignees
         FROM workflow_instances
         WHERE project_id = $1
         GROUP BY entity_type`,
        [projectId]
      );

      res.json({
        success: true,
        stats: statsResult.rows
      });

    } catch (error) {
      console.error('Error getting workflow statistics:', error);
      res.status(500).json({
        error: 'Failed to retrieve statistics',
        details: error.message
      });
    }
  });

  console.log('✅ Workflow API routes registered');
}

module.exports = { registerWorkflowRoutes };
