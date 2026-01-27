#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database configuration from environment variables
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : {
    rejectUnauthorized: false
  }
});

async function runMigration() {
  console.log('🚀 Starting workflow engine migration...\n');

  const client = await pool.connect();

  try {
    // Read the migration file
    const migrationPath = path.join(__dirname, 'migrations', '009_workflow_engine.sql');
    console.log(`📄 Reading migration file: ${migrationPath}`);

    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('⚙️  Executing migration...\n');

    // Execute the migration
    await client.query(sql);

    console.log('✅ Migration completed successfully!\n');

    // Verify tables were created
    console.log('🔍 Verifying tables...');
    const result = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename LIKE 'workflow%'
      ORDER BY tablename;
    `);

    console.log(`\n📊 Created ${result.rows.length} workflow tables:`);
    result.rows.forEach(row => {
      console.log(`   - ${row.tablename}`);
    });

    // Check templates
    const templateCount = await client.query(`
      SELECT COUNT(*) as count FROM workflow_templates;
    `);
    console.log(`\n📝 Seeded ${templateCount.rows[0].count} workflow templates`);

    // Check stages
    const stageCount = await client.query(`
      SELECT COUNT(*) as count FROM workflow_stages;
    `);
    console.log(`📝 Created ${stageCount.rows[0].count} workflow stages`);

    // Check transitions
    const transitionCount = await client.query(`
      SELECT COUNT(*) as count FROM workflow_transitions;
    `);
    console.log(`📝 Created ${transitionCount.rows[0].count} workflow transitions`);

    console.log('\n✨ Workflow engine is ready to use!');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
