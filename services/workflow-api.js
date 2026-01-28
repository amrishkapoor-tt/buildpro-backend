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
  // GET USER TASKS (MUST BE BEFORE :workflowId ROUTE)
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
  // GET PROJECT WORKFLOWS (MUST BE BEFORE :workflowId ROUTE)
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
  // GET WORKFLOW STATISTICS (MUST BE BEFORE :workflowId ROUTE)
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

  // ==========================================================================
  // GET WORKFLOW TEMPLATES (MUST BE BEFORE :workflowId ROUTE)
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
  // GET WORKFLOW TEMPLATE DETAILS (MUST BE BEFORE :workflowId ROUTE)
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
  // GET WORKFLOW BY ID
  // NOTE: This MUST come after all specific routes (/templates, /tasks, etc.)
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
  // CREATE WORKFLOW TEMPLATE
  // POST /api/v1/workflows/templates
  // ==========================================================================

  app.post('/api/v1/workflows/templates', authenticateToken, async (req, res) => {
    const client = await pool.connect();

    try {
      const { name, entity_type, description, is_active, stages, transitions } = req.body;

      // Validation
      if (!name || !entity_type) {
        return res.status(400).json({
          error: 'name and entity_type are required'
        });
      }

      if (!stages || !Array.isArray(stages) || stages.length === 0) {
        return res.status(400).json({
          error: 'At least one stage is required'
        });
      }

      await client.query('BEGIN');

      // If this is set as default, unset other defaults for this entity type
      if (req.body.is_default) {
        await client.query(
          `UPDATE workflow_templates SET is_default = false WHERE entity_type = $1`,
          [entity_type]
        );
      }

      // Create template
      const templateResult = await client.query(
        `INSERT INTO workflow_templates (name, entity_type, description, is_active, is_default, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [name, entity_type, description, is_active !== false, req.body.is_default || false, req.user.userId]
      );

      const template = templateResult.rows[0];

      // Create stages
      const stageIdMap = {}; // Map temp IDs to real IDs

      for (const stage of stages) {
        const stageResult = await client.query(
          `INSERT INTO workflow_stages (
            workflow_template_id,
            stage_number,
            stage_name,
            stage_type,
            sla_hours,
            assignment_rules,
            actions
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *`,
          [
            template.id,
            stage.stage_number,
            stage.stage_name,
            stage.stage_type || 'approval',
            stage.sla_hours || 48,
            stage.assignment_rules || { type: 'role', role: '' },
            stage.actions || ['approve', 'reject']
          ]
        );

        // Map the temporary ID (from frontend) to the real database ID
        stageIdMap[stage.stage_number] = stageResult.rows[0].id;
      }

      // Create transitions
      if (transitions && Array.isArray(transitions)) {
        for (const transition of transitions) {
          // Find the actual stage IDs based on stage numbers or names
          const fromStageResult = await client.query(
            `SELECT id FROM workflow_stages
             WHERE workflow_template_id = $1 AND stage_number = $2`,
            [template.id, transition.from_stage_number || 1]
          );

          const toStageResult = await client.query(
            `SELECT id FROM workflow_stages
             WHERE workflow_template_id = $1 AND stage_number = $2`,
            [template.id, transition.to_stage_number || 2]
          );

          if (fromStageResult.rows.length > 0 && toStageResult.rows.length > 0) {
            await client.query(
              `INSERT INTO workflow_transitions (
                workflow_template_id,
                from_stage_id,
                to_stage_id,
                transition_action,
                transition_name,
                is_automatic,
                conditions
              ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                template.id,
                fromStageResult.rows[0].id,
                toStageResult.rows[0].id,
                transition.transition_action || 'approve',
                transition.transition_name || 'Approve',
                transition.is_automatic || false,
                transition.conditions || {}
              ]
            );
          }
        }
      }

      await client.query('COMMIT');

      // Fetch complete template with stages and transitions
      const completeTemplate = await getCompleteTemplate(pool, template.id);

      res.status(201).json({
        success: true,
        message: 'Template created successfully',
        template: completeTemplate
      });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating workflow template:', error);
      res.status(500).json({
        error: 'Failed to create template',
        details: error.message
      });
    } finally {
      client.release();
    }
  });

  // ==========================================================================
  // UPDATE WORKFLOW TEMPLATE
  // PUT /api/v1/workflows/templates/:templateId
  // ==========================================================================

  app.put('/api/v1/workflows/templates/:templateId', authenticateToken, async (req, res) => {
    const client = await pool.connect();

    try {
      const { templateId } = req.params;
      const { name, entity_type, description, is_active, is_default, stages, transitions } = req.body;

      // Check if template exists
      const existingResult = await client.query(
        `SELECT * FROM workflow_templates WHERE id = $1`,
        [templateId]
      );

      if (existingResult.rows.length === 0) {
        return res.status(404).json({ error: 'Template not found' });
      }

      // Check if template is in use
      const inUseResult = await client.query(
        `SELECT COUNT(*) FROM workflow_instances WHERE workflow_template_id = $1 AND workflow_status = 'active'`,
        [templateId]
      );

      if (parseInt(inUseResult.rows[0].count) > 0) {
        return res.status(409).json({
          error: 'Cannot update template while it has active workflows',
          active_count: inUseResult.rows[0].count
        });
      }

      await client.query('BEGIN');

      // If this is set as default, unset other defaults for this entity type
      if (is_default) {
        await client.query(
          `UPDATE workflow_templates SET is_default = false WHERE entity_type = $1 AND id != $2`,
          [entity_type || existingResult.rows[0].entity_type, templateId]
        );
      }

      // Update template
      const updateResult = await client.query(
        `UPDATE workflow_templates
         SET name = COALESCE($1, name),
             entity_type = COALESCE($2, entity_type),
             description = COALESCE($3, description),
             is_active = COALESCE($4, is_active),
             is_default = COALESCE($5, is_default),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $6
         RETURNING *`,
        [name, entity_type, description, is_active, is_default, templateId]
      );

      // If stages are provided, replace them
      if (stages && Array.isArray(stages)) {
        // Delete existing stages and transitions
        await client.query(`DELETE FROM workflow_transitions WHERE workflow_template_id = $1`, [templateId]);
        await client.query(`DELETE FROM workflow_stages WHERE workflow_template_id = $1`, [templateId]);

        // Create new stages
        const stageIdMap = {};

        for (const stage of stages) {
          const stageResult = await client.query(
            `INSERT INTO workflow_stages (
              workflow_template_id,
              stage_number,
              stage_name,
              stage_type,
              sla_hours,
              assignment_rules,
              actions
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *`,
            [
              templateId,
              stage.stage_number,
              stage.stage_name,
              stage.stage_type || 'approval',
              stage.sla_hours || 48,
              stage.assignment_rules || { type: 'role', role: '' },
              stage.actions || ['approve', 'reject']
            ]
          );

          stageIdMap[stage.stage_number] = stageResult.rows[0].id;
        }

        // Create new transitions
        if (transitions && Array.isArray(transitions)) {
          for (const transition of transitions) {
            const fromStageResult = await client.query(
              `SELECT id FROM workflow_stages
               WHERE workflow_template_id = $1 AND stage_number = $2`,
              [templateId, transition.from_stage_number || 1]
            );

            const toStageResult = await client.query(
              `SELECT id FROM workflow_stages
               WHERE workflow_template_id = $1 AND stage_number = $2`,
              [templateId, transition.to_stage_number || 2]
            );

            if (fromStageResult.rows.length > 0 && toStageResult.rows.length > 0) {
              await client.query(
                `INSERT INTO workflow_transitions (
                  workflow_template_id,
                  from_stage_id,
                  to_stage_id,
                  transition_action,
                  transition_name,
                  is_automatic,
                  conditions
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                  templateId,
                  fromStageResult.rows[0].id,
                  toStageResult.rows[0].id,
                  transition.transition_action || 'approve',
                  transition.transition_name || 'Approve',
                  transition.is_automatic || false,
                  transition.conditions || {}
                ]
              );
            }
          }
        }
      }

      await client.query('COMMIT');

      // Fetch complete updated template
      const completeTemplate = await getCompleteTemplate(pool, templateId);

      res.json({
        success: true,
        message: 'Template updated successfully',
        template: completeTemplate
      });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error updating workflow template:', error);
      res.status(500).json({
        error: 'Failed to update template',
        details: error.message
      });
    } finally {
      client.release();
    }
  });

  // ==========================================================================
  // DELETE WORKFLOW TEMPLATE
  // DELETE /api/v1/workflows/templates/:templateId
  // ==========================================================================

  app.delete('/api/v1/workflows/templates/:templateId', authenticateToken, async (req, res) => {
    const client = await pool.connect();

    try {
      const { templateId } = req.params;

      // Check if template exists
      const existingResult = await client.query(
        `SELECT * FROM workflow_templates WHERE id = $1`,
        [templateId]
      );

      if (existingResult.rows.length === 0) {
        return res.status(404).json({ error: 'Template not found' });
      }

      // Check if template is in use
      const inUseResult = await client.query(
        `SELECT COUNT(*) FROM workflow_instances WHERE workflow_template_id = $1`,
        [templateId]
      );

      if (parseInt(inUseResult.rows[0].count) > 0) {
        return res.status(409).json({
          error: 'Cannot delete template that has been used in workflows',
          usage_count: inUseResult.rows[0].count,
          suggestion: 'Consider deactivating the template instead'
        });
      }

      await client.query('BEGIN');

      // Delete transitions
      await client.query(
        `DELETE FROM workflow_transitions WHERE workflow_template_id = $1`,
        [templateId]
      );

      // Delete stages
      await client.query(
        `DELETE FROM workflow_stages WHERE workflow_template_id = $1`,
        [templateId]
      );

      // Delete template
      await client.query(
        `DELETE FROM workflow_templates WHERE id = $1`,
        [templateId]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Template deleted successfully'
      });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deleting workflow template:', error);
      res.status(500).json({
        error: 'Failed to delete template',
        details: error.message
      });
    } finally {
      client.release();
    }
  });

  console.log('✅ Workflow API routes registered');
}

// ==========================================================================
// HELPER FUNCTIONS
// ==========================================================================

/**
 * Get complete template with stages and transitions
 */
async function getCompleteTemplate(pool, templateId) {
  const templateResult = await pool.query(
    `SELECT * FROM workflow_templates WHERE id = $1`,
    [templateId]
  );

  if (templateResult.rows.length === 0) {
    throw new Error('Template not found');
  }

  const template = templateResult.rows[0];

  const stagesResult = await pool.query(
    `SELECT * FROM workflow_stages WHERE workflow_template_id = $1 ORDER BY stage_number`,
    [templateId]
  );

  const transitionsResult = await pool.query(
    `SELECT
      wt.*,
      ws_from.stage_name AS from_stage_name,
      ws_from.stage_number AS from_stage_number,
      ws_to.stage_name AS to_stage_name,
      ws_to.stage_number AS to_stage_number
     FROM workflow_transitions wt
     LEFT JOIN workflow_stages ws_from ON ws_from.id = wt.from_stage_id
     LEFT JOIN workflow_stages ws_to ON ws_to.id = wt.to_stage_id
     WHERE wt.workflow_template_id = $1
     ORDER BY ws_from.stage_number NULLS FIRST`,
    [templateId]
  );

  return {
    ...template,
    stages: stagesResult.rows,
    transitions: transitionsResult.rows
  };
}

module.exports = { registerWorkflowRoutes };
