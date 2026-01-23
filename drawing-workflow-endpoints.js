// ============================================================================
// DRAWING WORKFLOW ENDPOINTS
// To be added to server.js after line 1580 (after existing DRAWINGS section)
// ============================================================================

// ==========================================================================
// DRAWING WORKFLOW STATE MANAGEMENT
// ==========================================================================

// Get drawing workflow state
app.get('/api/v1/drawings/:documentId/workflow', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT dws.*, u.first_name || ' ' || u.last_name as assigned_to_name,
       uc.first_name || ' ' || uc.last_name as created_by_name
       FROM drawing_workflow_states dws
       LEFT JOIN users u ON dws.assigned_to = u.id
       LEFT JOIN users uc ON dws.created_by = uc.id
       WHERE dws.document_id = $1
       ORDER BY dws.created_at DESC LIMIT 1`,
      [req.params.documentId]
    );

    if (result.rows.length === 0) {
      return res.json({ workflow_state: null });
    }

    res.json({ workflow_state: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Update drawing workflow state
app.post('/api/v1/drawings/:documentId/workflow', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { workflow_state, assigned_to, due_date, notes } = req.body;

    if (!workflow_state) {
      return res.status(400).json({ error: 'workflow_state is required' });
    }

    // Valid states
    const validStates = ['received', 'under_review', 'markup_in_progress', 'asi_pending', 'distributed', 'superseded', 'archived'];
    if (!validStates.includes(workflow_state)) {
      return res.status(400).json({ error: 'Invalid workflow_state' });
    }

    // Get current state if exists
    const currentStateResult = await pool.query(
      'SELECT workflow_state FROM drawing_workflow_states WHERE document_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.params.documentId]
    );
    const fromState = currentStateResult.rows.length > 0 ? currentStateResult.rows[0].workflow_state : null;

    // Insert new workflow state
    const result = await pool.query(
      `INSERT INTO drawing_workflow_states (document_id, workflow_state, assigned_to, due_date, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.documentId, workflow_state, assigned_to, due_date, notes, req.user.userId]
    );

    // Log workflow history
    await pool.query(
      `INSERT INTO drawing_workflow_history (document_id, from_state, to_state, changed_by, change_reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.documentId, fromState, workflow_state, req.user.userId, notes]
    );

    res.status(201).json({ workflow_state: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Get workflow history for a drawing
app.get('/api/v1/drawings/:documentId/workflow-history', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT dwh.*, u.first_name || ' ' || u.last_name as changed_by_name
       FROM drawing_workflow_history dwh
       LEFT JOIN users u ON dwh.changed_by = u.id
       WHERE dwh.document_id = $1
       ORDER BY dwh.created_at DESC`,
      [req.params.documentId]
    );
    res.json({ history: result.rows });
  } catch (error) {
    next(error);
  }
});

// ==========================================================================
// DRAWING MARKUPS (Document-based, new schema)
// ==========================================================================

// Get markups for a drawing
app.get('/api/v1/drawings/:documentId/markups', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT dm.*, u.first_name || ' ' || u.last_name as created_by_name,
       ur.first_name || ' ' || ur.last_name as resolved_by_name
       FROM drawing_markups dm
       LEFT JOIN users u ON dm.created_by = u.id
       LEFT JOIN users ur ON dm.resolved_by = ur.id
       WHERE dm.document_id = $1
       ORDER BY dm.created_at DESC`,
      [req.params.documentId]
    );
    res.json({ markups: result.rows });
  } catch (error) {
    next(error);
  }
});

// Create markup for a drawing
app.post('/api/v1/drawings/:documentId/markups', authenticateToken, checkPermission('subcontractor'), async (req, res, next) => {
  try {
    const { markup_data, markup_type, position_x, position_y, comment, color, linked_entity_type, linked_entity_id } = req.body;

    if (!markup_data) {
      return res.status(400).json({ error: 'markup_data is required' });
    }

    const result = await pool.query(
      `INSERT INTO drawing_markups
       (document_id, created_by, markup_data, markup_type, position_x, position_y, comment, color, linked_entity_type, linked_entity_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [req.params.documentId, req.user.userId, JSON.stringify(markup_data), markup_type, position_x, position_y, comment, color, linked_entity_type, linked_entity_id]
    );

    res.status(201).json({ markup: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Update markup
app.put('/api/v1/drawing-markups/:markupId', authenticateToken, async (req, res, next) => {
  try {
    const { markup_data, status, comment, color } = req.body;

    const result = await pool.query(
      `UPDATE drawing_markups
       SET markup_data = COALESCE($1, markup_data),
           status = COALESCE($2, status),
           comment = COALESCE($3, comment),
           color = COALESCE($4, color),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 RETURNING *`,
      [markup_data ? JSON.stringify(markup_data) : null, status, comment, color, req.params.markupId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Markup not found' });
    }

    res.json({ markup: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Resolve markup
app.post('/api/v1/drawing-markups/:markupId/resolve', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE drawing_markups
       SET status = 'resolved',
           resolved_by = $1,
           resolved_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [req.user.userId, req.params.markupId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Markup not found' });
    }

    res.json({ markup: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Delete markup
app.delete('/api/v1/drawing-markups/:markupId', authenticateToken, async (req, res, next) => {
  try {
    // Check if user created this markup or has permission
    const markup = await pool.query('SELECT created_by FROM drawing_markups WHERE id = $1', [req.params.markupId]);
    if (markup.rows.length === 0) {
      return res.status(404).json({ error: 'Markup not found' });
    }

    // Allow deletion if user created it or has superintendent permission
    if (markup.rows[0].created_by !== req.user.userId && req.user.role !== 'superintendent' && req.user.role !== 'project_manager') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    await pool.query('DELETE FROM drawing_markups WHERE id = $1', [req.params.markupId]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ==========================================================================
// DRAWING REVIEWS & COORDINATION
// ==========================================================================

// Get reviews for a drawing
app.get('/api/v1/drawings/:documentId/reviews', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT dr.*,
       u.first_name || ' ' || u.last_name as reviewer_name,
       ur.first_name || ' ' || ur.last_name as requested_by_name
       FROM drawing_reviews dr
       LEFT JOIN users u ON dr.reviewer_id = u.id
       LEFT JOIN users ur ON dr.requested_by = ur.id
       WHERE dr.document_id = $1
       ORDER BY dr.created_at DESC`,
      [req.params.documentId]
    );

    // Get checklist items for each review
    for (let review of result.rows) {
      const checklistResult = await pool.query(
        `SELECT drc.*, u.first_name || ' ' || u.last_name as checked_by_name
         FROM drawing_review_checklist drc
         LEFT JOIN users u ON drc.checked_by = u.id
         WHERE drc.review_id = $1
         ORDER BY drc.created_at`,
        [review.id]
      );
      review.checklist = checklistResult.rows;
    }

    res.json({ reviews: result.rows });
  } catch (error) {
    next(error);
  }
});

// Request drawing review
app.post('/api/v1/drawings/:documentId/reviews', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { reviewer_id, discipline, review_notes, checklist_items } = req.body;

    if (!reviewer_id) {
      return res.status(400).json({ error: 'reviewer_id is required' });
    }

    const result = await pool.query(
      `INSERT INTO drawing_reviews (document_id, reviewer_id, discipline, review_notes, requested_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.documentId, reviewer_id, discipline, review_notes, req.user.userId]
    );

    const review = result.rows[0];

    // Add checklist items if provided
    if (checklist_items && Array.isArray(checklist_items)) {
      for (let item of checklist_items) {
        await pool.query(
          `INSERT INTO drawing_review_checklist (review_id, item_description)
           VALUES ($1, $2)`,
          [review.id, item]
        );
      }
    }

    // TODO: Send notification to reviewer

    res.status(201).json({ review });
  } catch (error) {
    next(error);
  }
});

// Update review status
app.put('/api/v1/drawing-reviews/:reviewId', authenticateToken, async (req, res, next) => {
  try {
    const { review_status, review_notes, clash_detected, clash_description } = req.body;

    // Check if user is the assigned reviewer
    const review = await pool.query('SELECT reviewer_id FROM drawing_reviews WHERE id = $1', [req.params.reviewId]);
    if (review.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }

    if (review.rows[0].reviewer_id !== req.user.userId && req.user.role !== 'superintendent') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      `UPDATE drawing_reviews
       SET review_status = COALESCE($1, review_status),
           review_notes = COALESCE($2, review_notes),
           clash_detected = COALESCE($3, clash_detected),
           clash_description = COALESCE($4, clash_description),
           completed_at = CASE WHEN $1 IN ('approved', 'rejected') THEN CURRENT_TIMESTAMP ELSE completed_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 RETURNING *`,
      [review_status, review_notes, clash_detected, clash_description, req.params.reviewId]
    );

    res.json({ review: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Update checklist item
app.put('/api/v1/drawing-review-checklist/:itemId', authenticateToken, async (req, res, next) => {
  try {
    const { is_checked, notes } = req.body;

    const result = await pool.query(
      `UPDATE drawing_review_checklist
       SET is_checked = COALESCE($1, is_checked),
           notes = COALESCE($2, notes),
           checked_by = CASE WHEN $1 = true THEN $3 ELSE checked_by END,
           checked_at = CASE WHEN $1 = true THEN CURRENT_TIMESTAMP ELSE checked_at END
       WHERE id = $4 RETURNING *`,
      [is_checked, notes, req.user.userId, req.params.itemId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Checklist item not found' });
    }

    res.json({ item: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// ==========================================================================
// DRAWING DISTRIBUTION
// ==========================================================================

// Get distributions for a drawing
app.get('/api/v1/drawings/:documentId/distributions', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT dd.*,
       u.first_name || ' ' || u.last_name as distributed_to_name,
       ub.first_name || ' ' || ub.last_name as distributed_by_name
       FROM drawing_distributions dd
       LEFT JOIN users u ON dd.distributed_to_user_id = u.id
       LEFT JOIN users ub ON dd.distributed_by = ub.id
       WHERE dd.document_id = $1
       ORDER BY dd.created_at DESC`,
      [req.params.documentId]
    );
    res.json({ distributions: result.rows });
  } catch (error) {
    next(error);
  }
});

// Distribute drawing to user/role
app.post('/api/v1/drawings/:documentId/distribute', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { distributed_to_user_id, distributed_to_role, distribution_method, distribution_notes } = req.body;

    if (!distributed_to_user_id && !distributed_to_role) {
      return res.status(400).json({ error: 'Either distributed_to_user_id or distributed_to_role is required' });
    }

    const result = await pool.query(
      `INSERT INTO drawing_distributions
       (document_id, distributed_to_user_id, distributed_to_role, distribution_method, distribution_notes, distributed_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.documentId, distributed_to_user_id, distributed_to_role, distribution_method || 'manual', distribution_notes, req.user.userId]
    );

    // TODO: Send notification to recipient

    // Update workflow state to 'distributed' if not already
    const workflowCheck = await pool.query(
      'SELECT workflow_state FROM drawing_workflow_states WHERE document_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.params.documentId]
    );

    if (workflowCheck.rows.length === 0 || workflowCheck.rows[0].workflow_state !== 'distributed') {
      await pool.query(
        `INSERT INTO drawing_workflow_states (document_id, workflow_state, created_by, notes)
         VALUES ($1, 'distributed', $2, 'Auto-updated on distribution')`,
        [req.params.documentId, req.user.userId]
      );
    }

    res.status(201).json({ distribution: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Acknowledge distribution
app.post('/api/v1/drawing-distributions/:distributionId/acknowledge', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE drawing_distributions
       SET acknowledged = true,
           acknowledged_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *`,
      [req.params.distributionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Distribution not found' });
    }

    res.json({ distribution: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Bulk distribute drawing to multiple users/roles
app.post('/api/v1/drawings/:documentId/distribute-bulk', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { user_ids, roles, distribution_method, distribution_notes } = req.body;

    if ((!user_ids || user_ids.length === 0) && (!roles || roles.length === 0)) {
      return res.status(400).json({ error: 'user_ids or roles array required' });
    }

    const distributions = [];

    // Distribute to users
    if (user_ids && Array.isArray(user_ids)) {
      for (let userId of user_ids) {
        const result = await pool.query(
          `INSERT INTO drawing_distributions
           (document_id, distributed_to_user_id, distribution_method, distribution_notes, distributed_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [req.params.documentId, userId, distribution_method || 'manual', distribution_notes, req.user.userId]
        );
        distributions.push(result.rows[0]);
      }
    }

    // Distribute to roles
    if (roles && Array.isArray(roles)) {
      for (let role of roles) {
        const result = await pool.query(
          `INSERT INTO drawing_distributions
           (document_id, distributed_to_role, distribution_method, distribution_notes, distributed_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [req.params.documentId, role, distribution_method || 'manual', distribution_notes, req.user.userId]
        );
        distributions.push(result.rows[0]);
      }
    }

    res.status(201).json({ distributions, count: distributions.length });
  } catch (error) {
    next(error);
  }
});

// ==========================================================================
// ASI (ARCHITECT SUPPLEMENTAL INSTRUCTIONS)
// ==========================================================================

// Get ASIs for a project
app.get('/api/v1/projects/:projectId/asis', authenticateToken, async (req, res, next) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT a.*, u.first_name || ' ' || u.last_name as created_by_name,
      (SELECT COUNT(*) FROM asi_drawings WHERE asi_id = a.id) as affected_drawings_count
      FROM asis a
      LEFT JOIN users u ON a.created_by = u.id
      WHERE a.project_id = $1
    `;
    const params = [req.params.projectId];

    if (status) {
      query += ` AND a.status = $2`;
      params.push(status);
    }

    query += ` ORDER BY a.issue_date DESC, a.asi_number DESC`;

    const result = await pool.query(query, params);
    res.json({ asis: result.rows });
  } catch (error) {
    next(error);
  }
});

// Get single ASI with affected drawings
app.get('/api/v1/asis/:asiId', authenticateToken, async (req, res, next) => {
  try {
    const asiResult = await pool.query(
      `SELECT a.*, u.first_name || ' ' || u.last_name as created_by_name
       FROM asis a
       LEFT JOIN users u ON a.created_by = u.id
       WHERE a.id = $1`,
      [req.params.asiId]
    );

    if (asiResult.rows.length === 0) {
      return res.status(404).json({ error: 'ASI not found' });
    }

    const asi = asiResult.rows[0];

    // Get affected drawings
    const drawingsResult = await pool.query(
      `SELECT ad.*, d.name as drawing_name, d.drawing_number, d.discipline
       FROM asi_drawings ad
       INNER JOIN documents d ON ad.document_id = d.id
       WHERE ad.asi_id = $1`,
      [req.params.asiId]
    );

    asi.affected_drawings = drawingsResult.rows;

    res.json({ asi });
  } catch (error) {
    next(error);
  }
});

// Create ASI
app.post('/api/v1/projects/:projectId/asis', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const {
      asi_number, title, description, issued_by, issue_date, received_date,
      affects_cost, affects_schedule, estimated_cost_impact, estimated_schedule_impact_days
    } = req.body;

    if (!asi_number || !title) {
      return res.status(400).json({ error: 'asi_number and title are required' });
    }

    const result = await pool.query(
      `INSERT INTO asis
       (project_id, asi_number, title, description, issued_by, issue_date, received_date,
        affects_cost, affects_schedule, estimated_cost_impact, estimated_schedule_impact_days, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [req.params.projectId, asi_number, title, description, issued_by, issue_date, received_date,
       affects_cost, affects_schedule, estimated_cost_impact, estimated_schedule_impact_days, req.user.userId]
    );

    res.status(201).json({ asi: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'ASI number already exists for this project' });
    }
    next(error);
  }
});

// Update ASI
app.put('/api/v1/asis/:asiId', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const {
      title, description, issued_by, issue_date, received_date, status,
      affects_cost, affects_schedule, estimated_cost_impact, estimated_schedule_impact_days, incorporation_notes
    } = req.body;

    const result = await pool.query(
      `UPDATE asis
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           issued_by = COALESCE($3, issued_by),
           issue_date = COALESCE($4, issue_date),
           received_date = COALESCE($5, received_date),
           status = COALESCE($6, status),
           affects_cost = COALESCE($7, affects_cost),
           affects_schedule = COALESCE($8, affects_schedule),
           estimated_cost_impact = COALESCE($9, estimated_cost_impact),
           estimated_schedule_impact_days = COALESCE($10, estimated_schedule_impact_days),
           incorporation_notes = COALESCE($11, incorporation_notes),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $12 RETURNING *`,
      [title, description, issued_by, issue_date, received_date, status,
       affects_cost, affects_schedule, estimated_cost_impact, estimated_schedule_impact_days, incorporation_notes, req.params.asiId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ASI not found' });
    }

    res.json({ asi: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Link ASI to drawing
app.post('/api/v1/asis/:asiId/drawings/:documentId', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { impact_description, requires_revision } = req.body;

    const result = await pool.query(
      `INSERT INTO asi_drawings (asi_id, document_id, impact_description, requires_revision)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.asiId, req.params.documentId, impact_description, requires_revision !== false]
    );

    // Update drawing workflow state to 'asi_pending' if requires revision
    if (requires_revision !== false) {
      await pool.query(
        `INSERT INTO drawing_workflow_states (document_id, workflow_state, created_by, notes)
         VALUES ($1, 'asi_pending', $2, 'ASI linked - revision may be required')`,
        [req.params.documentId, req.user.userId]
      );
    }

    res.status(201).json({ asi_drawing: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'This drawing is already linked to this ASI' });
    }
    next(error);
  }
});

// Mark ASI-drawing revision as completed
app.post('/api/v1/asi-drawings/:asiDrawingId/complete', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE asi_drawings
       SET revision_completed = true,
           completed_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *`,
      [req.params.asiDrawingId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ASI-Drawing link not found' });
    }

    res.json({ asi_drawing: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Delete ASI
app.delete('/api/v1/asis/:asiId', authenticateToken, async (req, res, next) => {
  try {
    // Get ASI to find its project_id for permission check
    const asiResult = await pool.query('SELECT project_id FROM asis WHERE id = $1', [req.params.asiId]);

    if (asiResult.rows.length === 0) {
      return res.status(404).json({ error: 'ASI not found' });
    }

    // Set projectId for checkPermission middleware
    req.params.projectId = asiResult.rows[0].project_id;

    // Check permission manually - same level as create (engineer)
    const permissionCheck = checkPermission('engineer');
    await new Promise((resolve, reject) => {
      permissionCheck(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Delete the ASI (CASCADE will delete related asi_drawings)
    await pool.query('DELETE FROM asis WHERE id = $1', [req.params.asiId]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ==========================================================================
// DRAWING SETS (Enhanced version with new schema)
// ==========================================================================

// Create drawing set
app.post('/api/v1/projects/:projectId/drawing-sets-v2', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { set_name, set_description, set_type, issue_date } = req.body;

    if (!set_name) {
      return res.status(400).json({ error: 'set_name is required' });
    }

    const result = await pool.query(
      `INSERT INTO drawing_sets (project_id, set_name, set_description, set_type, issue_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.projectId, set_name, set_description, set_type, issue_date, req.user.userId]
    );

    res.status(201).json({ drawing_set: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Get drawing sets for project
app.get('/api/v1/projects/:projectId/drawing-sets-v2', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT ds.*, u.first_name || ' ' || u.last_name as created_by_name,
       (SELECT COUNT(*) FROM drawing_set_members WHERE drawing_set_id = ds.id) as drawing_count
       FROM drawing_sets ds
       LEFT JOIN users u ON ds.created_by = u.id
       WHERE ds.project_id = $1
       ORDER BY ds.created_at DESC`,
      [req.params.projectId]
    );
    res.json({ drawing_sets: result.rows });
  } catch (error) {
    next(error);
  }
});

// Add drawing to set
app.post('/api/v1/drawing-sets/:setId/members/:documentId', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    const { sequence_order } = req.body;

    const result = await pool.query(
      `INSERT INTO drawing_set_members (drawing_set_id, document_id, sequence_order)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.params.setId, req.params.documentId, sequence_order]
    );

    res.status(201).json({ member: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Drawing already in this set' });
    }
    next(error);
  }
});

// Remove drawing from set
app.delete('/api/v1/drawing-set-members/:memberId', authenticateToken, checkPermission('engineer'), async (req, res, next) => {
  try {
    await pool.query('DELETE FROM drawing_set_members WHERE id = $1', [req.params.memberId]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Get drawings in a set
app.get('/api/v1/drawing-sets/:setId/drawings', authenticateToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT d.*, dsm.sequence_order, dsm.id as member_id
       FROM drawing_set_members dsm
       INNER JOIN documents d ON dsm.document_id = d.id
       WHERE dsm.drawing_set_id = $1
       ORDER BY dsm.sequence_order, d.drawing_number`,
      [req.params.setId]
    );
    res.json({ drawings: result.rows });
  } catch (error) {
    next(error);
  }
});
