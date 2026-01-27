const fs = require('fs');
const path = require('path');

/**
 * Run database migrations automatically on server startup
 * Checks if tables exist before running to avoid duplicate migrations
 */
async function runMigrations(pool) {
  console.log('🔍 Checking for pending migrations...');

  const client = await pool.connect();

  try {
    // Check if workflow_templates table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'workflow_templates'
      );
    `);

    const tableExists = tableCheck.rows[0].exists;

    if (tableExists) {
      console.log('✅ Workflow tables already exist, skipping migration');
      return;
    }

    console.log('📊 Workflow tables not found, running migration...');

    // Read and execute the workflow migration
    const migrationPath = path.join(__dirname, '..', 'migrations', '009_workflow_engine.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    await client.query(sql);

    console.log('✅ Workflow migration completed successfully!');

    // Verify
    const verifyResult = await client.query(`
      SELECT COUNT(*) as count FROM workflow_templates;
    `);

    console.log(`📝 Seeded ${verifyResult.rows[0].count} workflow templates`);

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    // Don't crash the server, just log the error
    console.error('⚠️  Server will continue but workflow features may not work');
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };
