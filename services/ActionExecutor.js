// ============================================================================
// ACTION EXECUTOR SERVICE
// Executes automated actions during workflow transitions
// ============================================================================

class ActionExecutor {
  constructor(pool) {
    this.pool = pool;
  }

  // ==========================================================================
  // EXECUTE ACTIONS FOR STAGE
  // ==========================================================================

  /**
   * Execute all actions configured for a workflow stage
   * @param {Object} workflowInstance - Workflow instance object
   * @param {Object} stage - Workflow stage object
   * @param {Object} context - Execution context (actorId, transitionAction, etc.)
   * @returns {Promise<Array>} Results of all actions
   */
  async executeStageActions(workflowInstance, stage, context = {}) {
    if (!stage.actions || stage.actions.length === 0) {
      return [];
    }

    const actions = typeof stage.actions === 'string'
      ? JSON.parse(stage.actions)
      : stage.actions;

    const results = [];

    for (const action of actions) {
      try {
        const result = await this._executeAction(action, workflowInstance, stage, context);
        results.push({
          action: action.type,
          success: true,
          result
        });
      } catch (error) {
        console.error(`Failed to execute action ${action.type}:`, error);
        results.push({
          action: action.type,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  // ==========================================================================
  // PRIVATE ACTION HANDLERS
  // ==========================================================================

  /**
   * Execute a single action based on its type
   * @private
   */
  async _executeAction(action, workflowInstance, stage, context) {
    switch (action.type) {
      case 'send_notification':
        return await this._sendNotification(action, workflowInstance, stage, context);

      case 'update_entity_status':
        return await this._updateEntityStatus(action, workflowInstance, context);

      case 'create_audit_log':
        return await this._createAuditLog(action, workflowInstance, context);

      case 'trigger_webhook':
        return await this._triggerWebhook(action, workflowInstance, context);

      case 'auto_distribute':
        return await this._autoDistribute(action, workflowInstance, context);

      default:
        console.warn(`Unknown action type: ${action.type}`);
        return { skipped: true, reason: 'Unknown action type' };
    }
  }

  // ==========================================================================
  // SEND NOTIFICATION
  // ==========================================================================

  async _sendNotification(action, workflowInstance, stage, context) {
    const { assigneeId, actorId } = context;

    // Determine notification recipient
    let recipientId = assigneeId || workflowInstance.assigned_to;

    if (action.recipient === 'submitter') {
      recipientId = workflowInstance.started_by;
    } else if (action.recipient === 'actor') {
      recipientId = actorId;
    }

    if (!recipientId) {
      return { skipped: true, reason: 'No recipient found' };
    }

    // Build notification message based on template
    const notificationTitle = this._buildNotificationTitle(
      action.template,
      workflowInstance,
      stage
    );

    const notificationMessage = this._buildNotificationMessage(
      action.template,
      workflowInstance,
      stage,
      context
    );

    // Insert notification
    const result = await this.pool.query(
      `INSERT INTO notifications (
        user_id,
        title,
        message,
        notification_type,
        is_read
      ) VALUES ($1, $2, $3, $4, false)
      RETURNING id`,
      [recipientId, notificationTitle, notificationMessage, 'workflow']
    );

    return {
      notificationId: result.rows[0].id,
      recipientId,
      title: notificationTitle
    };
  }

  // ==========================================================================
  // UPDATE ENTITY STATUS
  // ==========================================================================

  async _updateEntityStatus(action, workflowInstance, context) {
    const { entity_type, entity_id } = workflowInstance;
    const newStatus = action.status || this._mapWorkflowStatusToEntityStatus(
      context.transitionAction,
      entity_type
    );

    if (!newStatus) {
      return { skipped: true, reason: 'No status mapping found' };
    }

    // Determine table name
    const tableName = this._getEntityTableName(entity_type);

    // Update entity status
    const result = await this.pool.query(
      `UPDATE ${tableName}
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, status`,
      [newStatus, entity_id]
    );

    if (result.rows.length === 0) {
      throw new Error(`Entity not found: ${entity_type} ${entity_id}`);
    }

    return {
      entityType: entity_type,
      entityId: entity_id,
      newStatus
    };
  }

  // ==========================================================================
  // CREATE AUDIT LOG
  // ==========================================================================

  async _createAuditLog(action, workflowInstance, context) {
    const { actorId, transitionAction, comments } = context;

    await this.pool.query(
      `INSERT INTO audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        changes
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        actorId,
        `workflow_${transitionAction}`,
        workflowInstance.entity_type,
        workflowInstance.entity_id,
        JSON.stringify({
          workflowInstanceId: workflowInstance.id,
          transitionAction,
          comments
        })
      ]
    );

    return { logged: true };
  }

  // ==========================================================================
  // TRIGGER WEBHOOK
  // ==========================================================================

  async _triggerWebhook(action, workflowInstance, context) {
    // Get project webhooks
    const webhookResult = await this.pool.query(
      `SELECT * FROM webhooks
       WHERE project_id = $1
         AND is_active = true
         AND event_types @> $2::jsonb`,
      [workflowInstance.project_id, JSON.stringify([action.event || 'workflow.transition'])]
    );

    if (webhookResult.rows.length === 0) {
      return { skipped: true, reason: 'No matching webhooks found' };
    }

    // Prepare webhook payload
    const payload = {
      event: action.event || 'workflow.transition',
      timestamp: new Date().toISOString(),
      workflow: {
        instanceId: workflowInstance.id,
        entityType: workflowInstance.entity_type,
        entityId: workflowInstance.entity_id,
        status: workflowInstance.workflow_status
      },
      context
    };

    // Queue webhook deliveries (in production, this would use a job queue)
    const deliveries = [];
    for (const webhook of webhookResult.rows) {
      try {
        // In production, this would be queued for async delivery
        // For now, we'll just log it
        deliveries.push({
          webhookId: webhook.id,
          url: webhook.url,
          queued: true
        });

        console.log(`Webhook queued: ${webhook.url}`, payload);
      } catch (error) {
        console.error(`Failed to queue webhook ${webhook.id}:`, error);
      }
    }

    return { deliveries };
  }

  // ==========================================================================
  // AUTO DISTRIBUTE
  // ==========================================================================

  async _autoDistribute(action, workflowInstance, context) {
    const { entity_type, entity_id } = workflowInstance;

    // Mark entity as distributed
    const tableName = this._getEntityTableName(entity_type);

    await this.pool.query(
      `UPDATE ${tableName}
       SET status = 'distributed',
           distributed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [entity_id]
    );

    // Create system event
    await this.pool.query(
      `INSERT INTO system_events (event_type, payload)
       VALUES ($1, $2)`,
      [
        `${entity_type}.distributed`,
        JSON.stringify({
          entityId: entity_id,
          workflowInstanceId: workflowInstance.id,
          distributedAt: new Date().toISOString()
        })
      ]
    );

    return {
      distributed: true,
      entityId: entity_id
    };
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  _getEntityTableName(entityType) {
    const tableMap = {
      'submittal': 'submittals',
      'rfi': 'rfis',
      'change_order': 'change_orders',
      'drawing': 'drawings',
      'punch_item': 'punch_items'
    };

    return tableMap[entityType] || entityType + 's';
  }

  _mapWorkflowStatusToEntityStatus(transitionAction, entityType) {
    const statusMap = {
      'approve': {
        'submittal': 'approved',
        'rfi': 'closed',
        'change_order': 'approved',
        'drawing': 'approved',
        'punch_item': 'completed'
      },
      'reject': {
        'submittal': 'rejected',
        'rfi': 'closed',
        'change_order': 'rejected',
        'drawing': 'rejected',
        'punch_item': 'rejected'
      },
      'revise': {
        'submittal': 'revisions_required',
        'rfi': 'pending_response',
        'change_order': 'pending',
        'drawing': 'revisions_required',
        'punch_item': 'in_progress'
      },
      'complete': {
        'submittal': 'distributed',
        'rfi': 'closed',
        'change_order': 'approved',
        'drawing': 'distributed',
        'punch_item': 'verified'
      }
    };

    return statusMap[transitionAction]?.[entityType];
  }

  _buildNotificationTitle(template, workflowInstance, stage) {
    const templates = {
      'review_request': `Action Required: ${workflowInstance.entity_type} Review`,
      'approval_request': `Approval Required: ${workflowInstance.entity_type}`,
      'approved': `${workflowInstance.entity_type} Approved`,
      'rejected': `${workflowInstance.entity_type} Rejected`,
      'revisions_required': `Revisions Required: ${workflowInstance.entity_type}`,
      'completed': `${workflowInstance.entity_type} Completed`
    };

    return templates[template] || `Workflow Update: ${workflowInstance.entity_type}`;
  }

  _buildNotificationMessage(template, workflowInstance, stage, context) {
    const entityType = workflowInstance.entity_type.replace('_', ' ');

    const messages = {
      'review_request': `A ${entityType} requires your review at the ${stage.stage_name} stage.`,
      'approval_request': `Your approval is requested for a ${entityType} at the ${stage.stage_name} stage.`,
      'approved': `The ${entityType} has been approved and moved forward.`,
      'rejected': `The ${entityType} has been rejected. ${context.comments || ''}`,
      'revisions_required': `Revisions are required for the ${entityType}. ${context.comments || ''}`,
      'completed': `The ${entityType} workflow has been completed.`
    };

    return messages[template] || `The ${entityType} workflow has been updated.`;
  }
}

module.exports = ActionExecutor;
