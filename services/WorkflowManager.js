// ============================================================================
// WORKFLOW MANAGER SERVICE
// Main orchestrator for workflow engine operations
// ============================================================================

const { v4: uuidv4 } = require('uuid');

class WorkflowManager {
  constructor(pool) {
    this.pool = pool;
  }

  // ==========================================================================
  // START WORKFLOW
  // ==========================================================================

  /**
   * Start a new workflow for an entity
   * @param {string} entityType - Type of entity (submittal, rfi, change_order, etc.)
   * @param {string} entityId - UUID of the entity
   * @param {string} projectId - UUID of the project
   * @param {string} userId - UUID of user starting the workflow
   * @returns {Promise<Object>} Created workflow instance
   */
  async startWorkflow(entityType, entityId, projectId, userId) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Check if workflow already exists for this entity
      const existingCheck = await client.query(
        `SELECT id, workflow_status FROM workflow_instances
         WHERE entity_type = $1 AND entity_id = $2`,
        [entityType, entityId]
      );

      if (existingCheck.rows.length > 0) {
        const existing = existingCheck.rows[0];
        if (existing.workflow_status === 'active') {
          throw new Error(`Active workflow already exists for this ${entityType}`);
        }
        // If previous workflow was completed/cancelled, we can start a new one
      }

      // Get default workflow template for this entity type
      const templateResult = await client.query(
        `SELECT id, name FROM workflow_templates
         WHERE entity_type = $1 AND is_default = true AND is_active = true
         LIMIT 1`,
        [entityType]
      );

      if (templateResult.rows.length === 0) {
        throw new Error(`No default workflow template found for entity type: ${entityType}`);
      }

      const template = templateResult.rows[0];

      // Get first stage of the workflow
      const firstStageResult = await client.query(
        `SELECT id, stage_name, sla_hours, assignment_rules
         FROM workflow_stages
         WHERE workflow_template_id = $1
         ORDER BY stage_number ASC
         LIMIT 1`,
        [template.id]
      );

      if (firstStageResult.rows.length === 0) {
        throw new Error(`No stages found for workflow template: ${template.name}`);
      }

      const firstStage = firstStageResult.rows[0];

      // Calculate SLA due date
      const stageDueAt = firstStage.sla_hours
        ? new Date(Date.now() + firstStage.sla_hours * 60 * 60 * 1000)
        : null;

      // Resolve assignee based on assignment rules
      const assignedTo = await this._resolveAssignee(
        client,
        projectId,
        firstStage.assignment_rules
      );

      // Create workflow instance
      const instanceResult = await client.query(
        `INSERT INTO workflow_instances (
          workflow_template_id,
          entity_type,
          entity_id,
          current_stage_id,
          workflow_status,
          assigned_to,
          assigned_at,
          stage_started_at,
          stage_due_at,
          project_id,
          started_by,
          started_at
        ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $7, $8, $9, CURRENT_TIMESTAMP)
        RETURNING *`,
        [
          template.id,
          entityType,
          entityId,
          firstStage.id,
          'active',
          assignedTo,
          stageDueAt,
          projectId,
          userId
        ]
      );

      const workflowInstance = instanceResult.rows[0];

      // Create history record
      await client.query(
        `INSERT INTO workflow_instance_history (
          workflow_instance_id,
          from_stage_id,
          to_stage_id,
          transition_action,
          actor_id,
          action_type,
          assigned_to,
          comments
        ) VALUES ($1, NULL, $2, 'start', $3, 'transition', $4, 'Workflow started')`,
        [workflowInstance.id, firstStage.id, userId, assignedTo]
      );

      // Create assignment record
      if (assignedTo) {
        await client.query(
          `INSERT INTO workflow_assignments (
            workflow_instance_id,
            stage_id,
            assignee_type,
            assignee_id,
            assignment_status
          ) VALUES ($1, $2, 'user', $3, 'active')`,
          [workflowInstance.id, firstStage.id, assignedTo]
        );
      }

      await client.query('COMMIT');

      return {
        ...workflowInstance,
        stage_name: firstStage.stage_name,
        template_name: template.name
      };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ==========================================================================
  // GET WORKFLOW FOR ENTITY
  // ==========================================================================

  /**
   * Get active workflow for an entity
   * @param {string} entityType - Type of entity
   * @param {string} entityId - UUID of the entity
   * @returns {Promise<Object|null>} Workflow instance or null
   */
  async getWorkflowForEntity(entityType, entityId) {
    const result = await this.pool.query(
      `SELECT
        wi.*,
        ws.stage_name,
        ws.stage_number,
        wt.name AS template_name,
        CONCAT(u.first_name, ' ', u.last_name) AS assignee_name,
        u.email AS assignee_email
       FROM workflow_instances wi
       INNER JOIN workflow_templates wt ON wt.id = wi.workflow_template_id
       LEFT JOIN workflow_stages ws ON ws.id = wi.current_stage_id
       LEFT JOIN users u ON u.id = wi.assigned_to
       WHERE wi.entity_type = $1 AND wi.entity_id = $2
       ORDER BY wi.created_at DESC
       LIMIT 1`,
      [entityType, entityId]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  // ==========================================================================
  // GET WORKFLOW HISTORY
  // ==========================================================================

  /**
   * Get complete history for a workflow instance
   * @param {string} workflowInstanceId - UUID of workflow instance
   * @returns {Promise<Array>} History records
   */
  async getWorkflowHistory(workflowInstanceId) {
    const result = await this.pool.query(
      `SELECT
        wih.*,
        ws_from.stage_name AS from_stage_name,
        ws_to.stage_name AS to_stage_name,
        CONCAT(u_actor.first_name, ' ', u_actor.last_name) AS actor_name,
        u_actor.email AS actor_email,
        CONCAT(u_assigned.first_name, ' ', u_assigned.last_name) AS assigned_to_name
       FROM workflow_instance_history wih
       LEFT JOIN workflow_stages ws_from ON ws_from.id = wih.from_stage_id
       LEFT JOIN workflow_stages ws_to ON ws_to.id = wih.to_stage_id
       LEFT JOIN users u_actor ON u_actor.id = wih.actor_id
       LEFT JOIN users u_assigned ON u_assigned.id = wih.assigned_to
       WHERE wih.workflow_instance_id = $1
       ORDER BY wih.created_at ASC`,
      [workflowInstanceId]
    );

    return result.rows;
  }

  // ==========================================================================
  // TRANSITION WORKFLOW
  // ==========================================================================

  /**
   * Execute a workflow transition
   * @param {string} workflowInstanceId - UUID of workflow instance
   * @param {string} transitionAction - Action to perform (approve, reject, etc.)
   * @param {string} actorId - UUID of user performing action
   * @param {string} comments - Optional comments
   * @returns {Promise<Object>} Updated workflow instance
   */
  async transitionWorkflow(workflowInstanceId, transitionAction, actorId, comments = null) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Get current workflow state
      const workflowResult = await client.query(
        `SELECT wi.*, ws.workflow_template_id, ws.stage_number
         FROM workflow_instances wi
         INNER JOIN workflow_stages ws ON ws.id = wi.current_stage_id
         WHERE wi.id = $1`,
        [workflowInstanceId]
      );

      if (workflowResult.rows.length === 0) {
        throw new Error('Workflow instance not found');
      }

      const workflow = workflowResult.rows[0];

      if (workflow.workflow_status !== 'active') {
        throw new Error(`Cannot transition workflow with status: ${workflow.workflow_status}`);
      }

      // Verify user is authorized to perform this action
      if (workflow.assigned_to && workflow.assigned_to !== actorId) {
        // TODO: Add role-based permission check
        console.warn(`User ${actorId} transitioning workflow assigned to ${workflow.assigned_to}`);
      }

      // Find valid transition
      const transitionResult = await client.query(
        `SELECT wt.*, ws_to.id AS to_stage_id, ws_to.stage_name AS to_stage_name,
                ws_to.sla_hours, ws_to.assignment_rules
         FROM workflow_transitions wt
         LEFT JOIN workflow_stages ws_to ON ws_to.id = wt.to_stage_id
         WHERE wt.workflow_template_id = $1
           AND wt.from_stage_id = $2
           AND wt.transition_action = $3
         LIMIT 1`,
        [workflow.workflow_template_id, workflow.current_stage_id, transitionAction]
      );

      if (transitionResult.rows.length === 0) {
        throw new Error(`Invalid transition: ${transitionAction} from current stage`);
      }

      const transition = transitionResult.rows[0];
      const currentStageId = workflow.current_stage_id;

      // Determine new workflow status and stage
      let newStatus = workflow.workflow_status;
      let newStageId = transition.to_stage_id;
      let stageDueAt = null;
      let assignedTo = null;

      if (newStageId === null) {
        // Workflow ends
        if (transitionAction === 'reject') {
          newStatus = 'rejected';
        } else {
          newStatus = 'completed';
        }
      } else {
        // Moving to next stage
        newStatus = 'active';

        // Calculate new SLA
        if (transition.sla_hours) {
          stageDueAt = new Date(Date.now() + transition.sla_hours * 60 * 60 * 1000);
        }

        // Resolve new assignee
        assignedTo = await this._resolveAssignee(
          client,
          workflow.project_id,
          transition.assignment_rules
        );
      }

      // Update workflow instance
      await client.query(
        `UPDATE workflow_instances
         SET current_stage_id = $1::UUID,
             workflow_status = $2::VARCHAR,
             assigned_to = $3::UUID,
             assigned_at = CASE WHEN $3::UUID IS NOT NULL THEN CURRENT_TIMESTAMP ELSE NULL END,
             stage_started_at = CASE WHEN $1::UUID IS NOT NULL THEN CURRENT_TIMESTAMP ELSE stage_started_at END,
             stage_due_at = $4::TIMESTAMP WITH TIME ZONE,
             completed_at = CASE WHEN $2::VARCHAR IN ('completed', 'rejected', 'cancelled') THEN CURRENT_TIMESTAMP ELSE NULL END,
             is_overdue = false
         WHERE id = $5::UUID`,
        [newStageId, newStatus, assignedTo, stageDueAt, workflowInstanceId]
      );

      // Create history record
      await client.query(
        `INSERT INTO workflow_instance_history (
          workflow_instance_id,
          from_stage_id,
          to_stage_id,
          transition_action,
          actor_id,
          action_type,
          assigned_to,
          comments
        ) VALUES ($1, $2, $3, $4, $5, 'transition', $6, $7)`,
        [
          workflowInstanceId,
          currentStageId,
          newStageId,
          transitionAction,
          actorId,
          assignedTo,
          comments
        ]
      );

      // Complete previous assignment
      await client.query(
        `UPDATE workflow_assignments
         SET assignment_status = 'completed',
             responded_at = CURRENT_TIMESTAMP,
             response_action = $1,
             response_comments = $2
         WHERE workflow_instance_id = $3
           AND stage_id = $4
           AND assignment_status = 'active'`,
        [transitionAction, comments, workflowInstanceId, currentStageId]
      );

      // Create new assignment if moving to a new stage
      if (newStageId && assignedTo) {
        await client.query(
          `INSERT INTO workflow_assignments (
            workflow_instance_id,
            stage_id,
            assignee_type,
            assignee_id,
            assignment_status
          ) VALUES ($1, $2, 'user', $3, 'active')`,
          [workflowInstanceId, newStageId, assignedTo]
        );
      }

      await client.query('COMMIT');

      // Return updated workflow
      return await this.getWorkflow(workflowInstanceId);

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ==========================================================================
  // GET WORKFLOW BY ID
  // ==========================================================================

  /**
   * Get workflow instance by ID
   * @param {string} workflowInstanceId - UUID of workflow instance
   * @returns {Promise<Object>} Workflow instance
   */
  async getWorkflow(workflowInstanceId) {
    const result = await this.pool.query(
      `SELECT
        wi.*,
        ws.stage_name,
        ws.stage_number,
        wt.name AS template_name,
        CONCAT(u.first_name, ' ', u.last_name) AS assignee_name,
        u.email AS assignee_email,
        p.name AS project_name
       FROM workflow_instances wi
       INNER JOIN workflow_templates wt ON wt.id = wi.workflow_template_id
       LEFT JOIN workflow_stages ws ON ws.id = wi.current_stage_id
       LEFT JOIN users u ON u.id = wi.assigned_to
       LEFT JOIN projects p ON p.id = wi.project_id
       WHERE wi.id = $1`,
      [workflowInstanceId]
    );

    if (result.rows.length === 0) {
      throw new Error('Workflow instance not found');
    }

    return result.rows[0];
  }

  // ==========================================================================
  // GET USER TASKS
  // ==========================================================================

  /**
   * Get all active tasks assigned to a user
   * @param {string} userId - UUID of user
   * @param {Object} filters - Optional filters (projectId, entityType)
   * @returns {Promise<Array>} List of tasks
   */
  async getUserTasks(userId, filters = {}) {
    let query = `
      SELECT * FROM active_workflow_tasks
      WHERE assignee_id = $1
    `;

    const params = [userId];
    let paramIndex = 2;

    if (filters.projectId) {
      query += ` AND project_id = $${paramIndex}`;
      params.push(filters.projectId);
      paramIndex++;
    }

    if (filters.entityType) {
      query += ` AND entity_type = $${paramIndex}`;
      params.push(filters.entityType);
      paramIndex++;
    }

    query += ` ORDER BY
      CASE urgency
        WHEN 'overdue' THEN 1
        WHEN 'due_soon' THEN 2
        ELSE 3
      END,
      stage_due_at ASC NULLS LAST`;

    const result = await this.pool.query(query, params);
    return result.rows;
  }

  // ==========================================================================
  // GET PROJECT WORKFLOWS
  // ==========================================================================

  /**
   * Get all workflows for a project
   * @param {string} projectId - UUID of project
   * @param {Object} filters - Optional filters
   * @returns {Promise<Array>} List of workflows
   */
  async getProjectWorkflows(projectId, filters = {}) {
    let query = `
      SELECT
        wi.*,
        ws.stage_name,
        wt.name AS template_name,
        CONCAT(u.first_name, ' ', u.last_name) AS assignee_name
      FROM workflow_instances wi
      INNER JOIN workflow_templates wt ON wt.id = wi.workflow_template_id
      LEFT JOIN workflow_stages ws ON ws.id = wi.current_stage_id
      LEFT JOIN users u ON u.id = wi.assigned_to
      WHERE wi.project_id = $1
    `;

    const params = [projectId];
    let paramIndex = 2;

    if (filters.entityType) {
      query += ` AND wi.entity_type = $${paramIndex}`;
      params.push(filters.entityType);
      paramIndex++;
    }

    if (filters.status) {
      query += ` AND wi.workflow_status = $${paramIndex}`;
      params.push(filters.status);
      paramIndex++;
    }

    query += ` ORDER BY wi.created_at DESC`;

    const result = await this.pool.query(query, params);
    return result.rows;
  }

  // ==========================================================================
  // CANCEL WORKFLOW
  // ==========================================================================

  /**
   * Cancel an active workflow
   * @param {string} workflowInstanceId - UUID of workflow instance
   * @param {string} actorId - UUID of user cancelling
   * @param {string} reason - Reason for cancellation
   * @returns {Promise<Object>} Updated workflow
   */
  async cancelWorkflow(workflowInstanceId, actorId, reason) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Update workflow status
      await client.query(
        `UPDATE workflow_instances
         SET workflow_status = 'cancelled',
             completed_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND workflow_status = 'active'`,
        [workflowInstanceId]
      );

      // Create history record
      await client.query(
        `INSERT INTO workflow_instance_history (
          workflow_instance_id,
          actor_id,
          action_type,
          comments
        ) VALUES ($1, $2, 'cancel', $3)`,
        [workflowInstanceId, actorId, reason]
      );

      // Cancel all active assignments
      await client.query(
        `UPDATE workflow_assignments
         SET assignment_status = 'skipped'
         WHERE workflow_instance_id = $1 AND assignment_status IN ('pending', 'active')`,
        [workflowInstanceId]
      );

      await client.query('COMMIT');

      return await this.getWorkflow(workflowInstanceId);

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ==========================================================================
  // PRIVATE HELPER METHODS
  // ==========================================================================

  /**
   * Resolve assignee based on assignment rules
   * @private
   */
  async _resolveAssignee(client, projectId, assignmentRules) {
    if (!assignmentRules || Object.keys(assignmentRules).length === 0) {
      return null;
    }

    const rules = typeof assignmentRules === 'string'
      ? JSON.parse(assignmentRules)
      : assignmentRules;

    if (rules.type === 'user' && rules.user_id) {
      return rules.user_id;
    }

    if (rules.type === 'role' && rules.role && projectId) {
      // Find first user with this role in the project
      const result = await client.query(
        `SELECT DISTINCT pm.user_id
         FROM project_members pm
         WHERE pm.project_id = $1
           AND pm.role = $2
         LIMIT 1`,
        [projectId, rules.role]
      );

      if (result.rows.length > 0) {
        return result.rows[0].user_id;
      }
    }

    return null;
  }
}

module.exports = WorkflowManager;
