// ============================================================================
// WORKFLOW ENGINE TEST SCRIPT
// Tests the workflow engine with submittal integration
// ============================================================================

require('dotenv').config();
const { Pool } = require('pg');
const WorkflowManager = require('./services/WorkflowManager');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/buildpro';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: false
});

async function runTests() {
  console.log('\n🧪 Starting Workflow Engine Tests...\n');

  try {
    const workflowManager = new WorkflowManager(pool);

    // ==========================================================================
    // TEST 1: Get existing submittal
    // ==========================================================================
    console.log('📋 TEST 1: Finding existing submittal...');

    const submittalResult = await pool.query(
      `SELECT s.id, sp.project_id, s.submittal_number, s.title, s.status, s.package_id
       FROM submittals s
       INNER JOIN submittal_packages sp ON sp.id = s.package_id
       LIMIT 1`
    );

    if (submittalResult.rows.length === 0) {
      console.log('❌ No submittals found in database. Creating test submittal...');

      const projectResult = await pool.query('SELECT id FROM projects LIMIT 1');
      if (projectResult.rows.length === 0) {
        throw new Error('No projects found. Please run bootstrap migration first.');
      }

      const userResult = await pool.query('SELECT id FROM users LIMIT 1');
      if (userResult.rows.length === 0) {
        throw new Error('No users found. Please run bootstrap migration first.');
      }

      // First create a submittal package
      const packageResult = await pool.query(
        `INSERT INTO submittal_packages (project_id, package_number, title, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [
          projectResult.rows[0].id,
          'PKG-TEST-001',
          'Test Workflow Package',
          userResult.rows[0].id
        ]
      );

      // Then create the submittal
      const newSubmittal = await pool.query(
        `INSERT INTO submittals (package_id, submittal_number, title, status, submitted_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          packageResult.rows[0].id,
          'TEST-001',
          'Test Workflow Submittal',
          'draft',
          userResult.rows[0].id
        ]
      );

      // Fetch with project_id included
      const finalResult = await pool.query(
        `SELECT s.*, sp.project_id
         FROM submittals s
         INNER JOIN submittal_packages sp ON sp.id = s.package_id
         WHERE s.id = $1`,
        [newSubmittal.rows[0].id]
      );

      submittalResult.rows[0] = finalResult.rows[0];
      console.log('✅ Test submittal created:', finalResult.rows[0].submittal_number);
    }

    const submittal = submittalResult.rows[0];
    console.log(`✅ Found submittal: ${submittal.submittal_number} - ${submittal.title}`);
    console.log(`   Status: ${submittal.status}, Project ID: ${submittal.project_id}\n`);

    // ==========================================================================
    // TEST 2: Start workflow
    // ==========================================================================
    console.log('📋 TEST 2: Starting workflow for submittal...');

    // Check if workflow already exists
    const existingWorkflow = await workflowManager.getWorkflowForEntity('submittal', submittal.id);

    let workflow;
    if (existingWorkflow) {
      console.log('⚠️  Workflow already exists for this submittal');
      workflow = existingWorkflow;
    } else {
      const userResult = await pool.query('SELECT id FROM users LIMIT 1');
      const userId = userResult.rows[0].id;

      workflow = await workflowManager.startWorkflow(
        'submittal',
        submittal.id,
        submittal.project_id,
        userId
      );
      console.log('✅ Workflow started successfully!');
    }

    console.log(`   Workflow ID: ${workflow.id}`);
    console.log(`   Template: ${workflow.template_name}`);
    console.log(`   Current Stage: ${workflow.stage_name}`);
    console.log(`   Status: ${workflow.workflow_status}`);
    console.log(`   Assigned To: ${workflow.assignee_name || 'Unassigned'}\n`);

    // ==========================================================================
    // TEST 3: Get workflow history
    // ==========================================================================
    console.log('📋 TEST 3: Retrieving workflow history...');

    const history = await workflowManager.getWorkflowHistory(workflow.id);
    console.log(`✅ Found ${history.length} history record(s):`);

    history.forEach((record, index) => {
      console.log(`   ${index + 1}. ${record.action_type} by ${record.actor_name || 'System'}`);
      console.log(`      From: ${record.from_stage_name || 'Start'} → To: ${record.to_stage_name || 'End'}`);
      console.log(`      Date: ${record.created_at}`);
    });
    console.log('');

    // ==========================================================================
    // TEST 4: Get available transitions
    // ==========================================================================
    console.log('📋 TEST 4: Getting available transitions...');

    const transitionsResult = await pool.query(
      `SELECT
        wt.*,
        ws_to.stage_name AS to_stage_name
       FROM workflow_transitions wt
       LEFT JOIN workflow_stages ws_to ON ws_to.id = wt.to_stage_id
       WHERE wt.workflow_template_id = $1
         AND wt.from_stage_id = $2`,
      [workflow.workflow_template_id, workflow.current_stage_id]
    );

    console.log(`✅ Found ${transitionsResult.rows.length} available transition(s):`);

    transitionsResult.rows.forEach((transition, index) => {
      console.log(`   ${index + 1}. Action: ${transition.transition_action}`);
      console.log(`      To Stage: ${transition.to_stage_name || 'End Workflow'}`);
      console.log(`      Auto: ${transition.is_automatic ? 'Yes' : 'No'}`);
    });
    console.log('');

    // ==========================================================================
    // TEST 5: Execute transition (only if workflow is still active)
    // ==========================================================================
    if (workflow.workflow_status === 'active' && transitionsResult.rows.length > 0) {
      console.log('📋 TEST 5: Executing workflow transition...');

      const firstTransition = transitionsResult.rows[0];
      console.log(`   Executing: ${firstTransition.transition_action}`);

      const userResult = await pool.query('SELECT id FROM users LIMIT 1');
      const userId = userResult.rows[0].id;

      const updatedWorkflow = await workflowManager.transitionWorkflow(
        workflow.id,
        firstTransition.transition_action,
        userId,
        'Test transition from automated test script'
      );

      console.log('✅ Transition executed successfully!');
      console.log(`   New Stage: ${updatedWorkflow.stage_name || 'Completed'}`);
      console.log(`   New Status: ${updatedWorkflow.workflow_status}`);
      console.log(`   Assigned To: ${updatedWorkflow.assignee_name || 'Unassigned'}\n`);

      // Get updated history
      const newHistory = await workflowManager.getWorkflowHistory(workflow.id);
      console.log(`✅ Updated history now has ${newHistory.length} record(s)\n`);
    } else {
      console.log('⚠️  TEST 5 SKIPPED: Workflow is not active or no transitions available\n');
    }

    // ==========================================================================
    // TEST 6: Get user tasks
    // ==========================================================================
    console.log('📋 TEST 6: Getting user tasks...');

    const userResult = await pool.query('SELECT id, first_name, last_name FROM users LIMIT 1');
    const user = userResult.rows[0];

    const tasks = await workflowManager.getUserTasks(user.id);
    console.log(`✅ User ${user.first_name} ${user.last_name} has ${tasks.length} active task(s)\n`);

    // ==========================================================================
    // TEST 7: Get project workflows
    // ==========================================================================
    console.log('📋 TEST 7: Getting project workflows...');

    const projectWorkflows = await workflowManager.getProjectWorkflows(submittal.project_id);
    console.log(`✅ Project has ${projectWorkflows.length} workflow(s)\n`);

    // ==========================================================================
    // TEST 8: Verify database state
    // ==========================================================================
    console.log('📋 TEST 8: Verifying database state...');

    const statsResult = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM workflow_templates) AS templates,
        (SELECT COUNT(*) FROM workflow_stages) AS stages,
        (SELECT COUNT(*) FROM workflow_transitions) AS transitions,
        (SELECT COUNT(*) FROM workflow_instances) AS instances,
        (SELECT COUNT(*) FROM workflow_instance_history) AS history_records
    `);

    const stats = statsResult.rows[0];
    console.log('✅ Database state:');
    console.log(`   Templates: ${stats.templates}`);
    console.log(`   Stages: ${stats.stages}`);
    console.log(`   Transitions: ${stats.transitions}`);
    console.log(`   Active Instances: ${stats.instances}`);
    console.log(`   History Records: ${stats.history_records}\n`);

    console.log('✅ All tests completed successfully!\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
