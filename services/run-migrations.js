const fs = require('fs');
const path = require('path');

/**
 * ============================================================================
 * BUILDPRO MIGRATION SYSTEM
 * ============================================================================
 *
 * Simple check-and-run migration system that executes on server startup.
 *
 * HOW IT WORKS:
 * 1. Each migration has a "check table" - a main table it creates
 * 2. On startup, we check if that table exists
 * 3. If not, we run the migration SQL file
 * 4. If yes, we skip it (tables already created)
 *
 * ADDING NEW MIGRATIONS:
 * 1. Create new SQL file: migrations/010_your_feature.sql
 * 2. Add a new check block below following the existing pattern
 * 3. Choose a unique main table to check for existence
 * 4. Test locally before deploying
 *
 * See migrations/README.md for detailed instructions!
 * ============================================================================
 */
async function runMigrations(pool) {
  console.log('🔍 Checking for pending migrations...');

  const client = await pool.connect();

  try {
    // ==========================================================================
    // MIGRATION 009: Workflow Engine
    // Purpose: Complete workflow system with templates, stages, transitions
    // Check Table: workflow_templates
    // File: migrations/009_workflow_engine.sql
    // ==========================================================================

    const workflowCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'workflow_templates'
      );
    `);

    if (!workflowCheck.rows[0].exists) {
      console.log('📊 Running migration 009: Workflow Engine...');

      const migrationPath = path.join(__dirname, '..', 'migrations', '009_workflow_engine.sql');
      const sql = fs.readFileSync(migrationPath, 'utf8');
      await client.query(sql);

      // Verify migration success
      const verifyResult = await client.query(`
        SELECT COUNT(*) as count FROM workflow_templates;
      `);

      console.log('✅ Migration 009 completed');
      console.log(`   📝 Seeded ${verifyResult.rows[0].count} workflow templates`);
    }

    // ==========================================================================
    // HOTFIX 009: Add project_id to active_workflow_tasks view
    // Purpose: Fix missing project_id column causing 500 errors
    // Check: Query view columns to see if project_id exists
    // ==========================================================================

    if (workflowCheck.rows[0].exists) {
      // Only run this if workflow tables exist (meaning migration 009 ran)
      const viewColumnCheck = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'active_workflow_tasks'
        AND column_name = 'project_id';
      `);

      if (viewColumnCheck.rows.length === 0) {
        console.log('📊 Running hotfix 009: Add project_id to view...');

        const hotfixPath = path.join(__dirname, '..', 'migrations', '009_hotfix_add_project_id_to_view.sql');
        const hotfixSql = fs.readFileSync(hotfixPath, 'utf8');
        await client.query(hotfixSql);

        console.log('✅ Hotfix 009 completed - view now includes project_id');
      }
    }

    // ==========================================================================
    // ADD NEW MIGRATIONS HERE
    // Copy the block above and modify for your new migration:
    //
    // const yourFeatureCheck = await client.query(`
    //   SELECT EXISTS (
    //     SELECT FROM information_schema.tables
    //     WHERE table_schema = 'public'
    //     AND table_name = 'your_main_table'
    //   );
    // `);
    //
    // if (!yourFeatureCheck.rows[0].exists) {
    //   console.log('📊 Running migration 010: Your Feature...');
    //
    //   const sql = fs.readFileSync(
    //     path.join(__dirname, '..', 'migrations', '010_your_feature.sql'),
    //     'utf8'
    //   );
    //   await client.query(sql);
    //
    //   console.log('✅ Migration 010 completed');
    // }
    // ==========================================================================

    console.log('✅ All migrations up to date');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('   Full error:', error);
    // Don't crash the server, just log the error
    console.error('⚠️  Server will continue but features from failed migration may not work');
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };
