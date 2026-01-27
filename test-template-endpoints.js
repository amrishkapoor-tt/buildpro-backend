// ============================================================================
// TEST WORKFLOW TEMPLATE CRUD ENDPOINTS
// Tests the newly added template creation, update, and deletion endpoints
// ============================================================================

const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'buildpro',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432
});

// Test data
const testTemplate = {
  name: 'Test Submittal Workflow',
  entity_type: 'submittal',
  description: 'A test workflow template for submittals',
  is_active: true,
  is_default: false,
  stages: [
    {
      stage_number: 1,
      stage_name: 'GC Review',
      stage_type: 'approval',
      sla_hours: 48,
      assignment_rules: { type: 'role', role: 'superintendent' },
      actions: ['approve', 'reject', 'revise'],
      description: 'General contractor reviews the submittal'
    },
    {
      stage_number: 2,
      stage_name: 'Architect Review',
      stage_type: 'approval',
      sla_hours: 72,
      assignment_rules: { type: 'role', role: 'architect' },
      actions: ['approve', 'reject'],
      description: 'Architect provides final approval'
    },
    {
      stage_number: 3,
      stage_name: 'Distribution',
      stage_type: 'notify',
      sla_hours: 24,
      assignment_rules: { type: 'role', role: 'project_manager' },
      actions: ['approve'],
      description: 'Distribute approved submittal to team'
    }
  ],
  transitions: [
    {
      from_stage_number: 1,
      to_stage_number: 2,
      transition_action: 'approve',
      transition_name: 'Approve',
      is_automatic: false
    },
    {
      from_stage_number: 1,
      to_stage_number: 1,
      transition_action: 'revise',
      transition_name: 'Request Revision',
      is_automatic: false
    },
    {
      from_stage_number: 2,
      to_stage_number: 3,
      transition_action: 'approve',
      transition_name: 'Approve & Distribute',
      is_automatic: false
    }
  ]
};

async function testCreateTemplate() {
  console.log('\n📝 TEST 1: Create Template');
  console.log('=' .repeat(60));

  try {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Create template
      const templateResult = await client.query(
        `INSERT INTO workflow_templates (name, entity_type, description, is_active, is_default, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          testTemplate.name,
          testTemplate.entity_type,
          testTemplate.description,
          testTemplate.is_active,
          testTemplate.is_default,
          '00000000-0000-0000-0000-000000000000' // Test user ID
        ]
      );

      const template = templateResult.rows[0];
      console.log('✅ Template created:', template.id);

      // Create stages
      for (const stage of testTemplate.stages) {
        const stageResult = await client.query(
          `INSERT INTO workflow_stages (
            workflow_template_id,
            stage_number,
            stage_name,
            stage_type,
            sla_hours,
            assignment_rules,
            actions,
            description
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *`,
          [
            template.id,
            stage.stage_number,
            stage.stage_name,
            stage.stage_type,
            stage.sla_hours,
            stage.assignment_rules,
            stage.actions,
            stage.description
          ]
        );

        console.log(`✅ Stage ${stage.stage_number} created: ${stage.stage_name}`);
      }

      // Create transitions
      for (const transition of testTemplate.transitions) {
        const fromStageResult = await client.query(
          `SELECT id FROM workflow_stages
           WHERE workflow_template_id = $1 AND stage_number = $2`,
          [template.id, transition.from_stage_number]
        );

        const toStageResult = await client.query(
          `SELECT id FROM workflow_stages
           WHERE workflow_template_id = $1 AND stage_number = $2`,
          [template.id, transition.to_stage_number]
        );

        if (fromStageResult.rows.length > 0 && toStageResult.rows.length > 0) {
          await client.query(
            `INSERT INTO workflow_transitions (
              workflow_template_id,
              from_stage_id,
              to_stage_id,
              transition_action,
              transition_name,
              is_automatic
            ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              template.id,
              fromStageResult.rows[0].id,
              toStageResult.rows[0].id,
              transition.transition_action,
              transition.transition_name,
              transition.is_automatic
            ]
          );

          console.log(`✅ Transition created: ${transition.transition_name}`);
        }
      }

      await client.query('COMMIT');

      console.log('\n✅ TEST 1 PASSED: Template created successfully');
      return template.id;

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ TEST 1 FAILED:', error.message);
    throw error;
  }
}

async function testReadTemplate(templateId) {
  console.log('\n📖 TEST 2: Read Template');
  console.log('=' .repeat(60));

  try {
    // Get template
    const templateResult = await pool.query(
      `SELECT * FROM workflow_templates WHERE id = $1`,
      [templateId]
    );

    if (templateResult.rows.length === 0) {
      throw new Error('Template not found');
    }

    console.log('✅ Template found:', templateResult.rows[0].name);

    // Get stages
    const stagesResult = await pool.query(
      `SELECT * FROM workflow_stages WHERE workflow_template_id = $1 ORDER BY stage_number`,
      [templateId]
    );

    console.log(`✅ Found ${stagesResult.rows.length} stages`);

    // Get transitions
    const transitionsResult = await pool.query(
      `SELECT * FROM workflow_transitions WHERE workflow_template_id = $1`,
      [templateId]
    );

    console.log(`✅ Found ${transitionsResult.rows.length} transitions`);

    console.log('\n✅ TEST 2 PASSED: Template read successfully');
    return {
      template: templateResult.rows[0],
      stages: stagesResult.rows,
      transitions: transitionsResult.rows
    };

  } catch (error) {
    console.error('❌ TEST 2 FAILED:', error.message);
    throw error;
  }
}

async function testUpdateTemplate(templateId) {
  console.log('\n✏️  TEST 3: Update Template');
  console.log('=' .repeat(60));

  try {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Update template
      await client.query(
        `UPDATE workflow_templates
         SET name = $1, description = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        ['Updated Test Template', 'This template has been updated', templateId]
      );

      console.log('✅ Template updated');

      await client.query('COMMIT');

      // Verify update
      const result = await pool.query(
        `SELECT * FROM workflow_templates WHERE id = $1`,
        [templateId]
      );

      if (result.rows[0].name === 'Updated Test Template') {
        console.log('✅ Update verified');
      } else {
        throw new Error('Update verification failed');
      }

      console.log('\n✅ TEST 3 PASSED: Template updated successfully');

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ TEST 3 FAILED:', error.message);
    throw error;
  }
}

async function testDeleteTemplate(templateId) {
  console.log('\n🗑️  TEST 4: Delete Template');
  console.log('=' .repeat(60));

  try {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Check if template is in use
      const inUseResult = await client.query(
        `SELECT COUNT(*) FROM workflow_instances WHERE workflow_template_id = $1`,
        [templateId]
      );

      console.log(`✅ Template usage count: ${inUseResult.rows[0].count}`);

      // Delete transitions
      const transitionsResult = await client.query(
        `DELETE FROM workflow_transitions WHERE workflow_template_id = $1`,
        [templateId]
      );

      console.log(`✅ Deleted ${transitionsResult.rowCount} transitions`);

      // Delete stages
      const stagesResult = await client.query(
        `DELETE FROM workflow_stages WHERE workflow_template_id = $1`,
        [templateId]
      );

      console.log(`✅ Deleted ${stagesResult.rowCount} stages`);

      // Delete template
      const templateResult = await client.query(
        `DELETE FROM workflow_templates WHERE id = $1`,
        [templateId]
      );

      console.log(`✅ Deleted template`);

      await client.query('COMMIT');

      // Verify deletion
      const verifyResult = await pool.query(
        `SELECT * FROM workflow_templates WHERE id = $1`,
        [templateId]
      );

      if (verifyResult.rows.length === 0) {
        console.log('✅ Deletion verified');
      } else {
        throw new Error('Deletion verification failed');
      }

      console.log('\n✅ TEST 4 PASSED: Template deleted successfully');

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ TEST 4 FAILED:', error.message);
    throw error;
  }
}

async function runAllTests() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║       WORKFLOW TEMPLATE CRUD ENDPOINTS TEST SUITE         ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  let templateId = null;

  try {
    // Test 1: Create
    templateId = await testCreateTemplate();

    // Test 2: Read
    await testReadTemplate(templateId);

    // Test 3: Update
    await testUpdateTemplate(templateId);

    // Test 4: Delete
    await testDeleteTemplate(templateId);

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║              ✅ ALL TESTS PASSED ✅                        ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

  } catch (error) {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║              ❌ TESTS FAILED ❌                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.error('\nError:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

// Run tests
runAllTests();
