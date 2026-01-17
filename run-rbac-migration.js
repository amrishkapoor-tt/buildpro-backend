#!/usr/bin/env node
/**
 * RBAC Migration Runner
 * Safely applies RBAC enhancements to production database
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." node run-rbac-migration.js
 */

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Error: DATABASE_URL environment variable is required');
  console.error('\nUsage:');
  console.error('  DATABASE_URL="postgresql://user:pass@host:port/database" node run-rbac-migration.js');
  process.exit(1);
}

// Determine if SSL is needed (for cloud databases)
const sslConfig = DATABASE_URL.includes('localhost')
  ? false
  : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: sslConfig
});

async function runMigration() {
  const client = await pool.connect();

  try {
    // Extract database info for display
    const dbName = DATABASE_URL.split('/').pop().split('?')[0];
    const host = DATABASE_URL.split('@')[1]?.split('/')[0] || 'unknown';

    console.log('\n📊 RBAC Migration');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Database: ${dbName} @ ${host}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Step 1: Check if audit_logs table exists
    console.log('🔍 Step 1/3: Checking for audit_logs table...');
    const auditLogsCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'audit_logs'
      );
    `);

    const auditLogsExists = auditLogsCheck.rows[0].exists;
    if (auditLogsExists) {
      console.log('   ✅ audit_logs table exists\n');
    } else {
      console.log('   ⚠️  audit_logs table does NOT exist - will create\n');
    }

    // Step 2: Check current projects table structure
    console.log('🔍 Step 2/3: Checking projects table columns...');
    const columnsCheck = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'projects'
      AND column_name IN ('created_by', 'owner_user_id');
    `);

    const existingColumns = columnsCheck.rows.map(row => row.column_name);
    if (existingColumns.length > 0) {
      console.log(`   ℹ️  Found existing columns: ${existingColumns.join(', ')}`);
    } else {
      console.log('   ℹ️  No ownership columns found - will add');
    }
    console.log('');

    // Step 3: Apply migration
    console.log('🚀 Step 3/3: Applying RBAC migration...');
    console.log('   This is SAFE - uses IF NOT EXISTS clauses\n');

    await client.query('BEGIN');

    // Create audit_logs table if it doesn't exist
    if (!auditLogsExists) {
      console.log('   📝 Creating audit_logs table...');
      await client.query(`
        CREATE TABLE audit_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID REFERENCES users(id),
          action VARCHAR(50) NOT NULL,
          entity_type VARCHAR(50) NOT NULL,
          entity_id UUID,
          changes JSONB,
          ip_address VARCHAR(50),
          user_agent TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log('   ✅ audit_logs table created');

      console.log('   📝 Creating audit_logs indexes...');
      await client.query(`
        CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
      `);
      await client.query(`
        CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
      `);
      await client.query(`
        CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
      `);
      console.log('   ✅ Indexes created\n');
    }

    // Add project ownership columns
    console.log('   📝 Adding project ownership columns...');
    await client.query(`
      ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id);
    `);
    console.log('   ✅ Columns added');

    console.log('   📝 Creating indexes for performance...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_user_id);
    `);
    console.log('   ✅ Indexes created\n');

    await client.query('COMMIT');

    // Final verification
    console.log('🔍 Verifying migration...');
    const verification = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'projects'
      AND column_name IN ('created_by', 'owner_user_id')
      ORDER BY column_name;
    `);

    console.log('\n✅ Migration completed successfully!');
    console.log('\n📋 Projects table now has:');
    verification.rows.forEach(row => {
      console.log(`   - ${row.column_name} (${row.data_type})`);
    });

    const auditCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'audit_logs'
      );
    `);

    if (auditCheck.rows[0].exists) {
      console.log('\n✅ audit_logs table is ready');
    }

    console.log('\n🎉 RBAC system is now fully configured!\n');
    console.log('Next steps:');
    console.log('  1. Deploy the updated backend to production');
    console.log('  2. Deploy the updated frontend to production');
    console.log('  3. Test team management features\n');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ Migration failed:', error.message);
    console.error('\nFull error:');
    console.error(error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration failed\n');
    process.exit(1);
  });
