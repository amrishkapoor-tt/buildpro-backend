#!/usr/bin/env node
/**
 * Database Migration Runner
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." node migrate.js migrations/006_scheduling_system.sql
 *
 * Or set DATABASE_URL in your shell first:
 *   export DATABASE_URL="postgresql://..."
 *   node migrate.js migrations/006_scheduling_system.sql
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Get DATABASE_URL from environment or command line
const DATABASE_URL = process.env.DATABASE_URL;
const migrationFile = process.argv[2];

if (!DATABASE_URL) {
  console.error('❌ Error: DATABASE_URL environment variable is required');
  console.error('\nUsage:');
  console.error('  DATABASE_URL="postgresql://..." node migrate.js migrations/006_scheduling_system.sql');
  console.error('\nOr set it first:');
  console.error('  export DATABASE_URL="postgresql://user:pass@host:port/database"');
  console.error('  node migrate.js migrations/006_scheduling_system.sql');
  process.exit(1);
}

if (!migrationFile) {
  console.error('❌ Error: Please provide a migration file');
  console.error('\nUsage:');
  console.error('  node migrate.js migrations/006_scheduling_system.sql');
  console.error('\nAvailable migrations:');
  const migrationsDir = path.join(__dirname, 'migrations');
  if (fs.existsSync(migrationsDir)) {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
    files.forEach(f => console.error(`  - migrations/${f}`));
  }
  process.exit(1);
}

const fullPath = path.resolve(__dirname, migrationFile);
if (!fs.existsSync(fullPath)) {
  console.error(`❌ Error: Migration file not found: ${fullPath}`);
  process.exit(1);
}

// Determine if SSL is needed (for Render and most cloud databases)
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
    console.log('🔄 Reading migration file...');
    const sql = fs.readFileSync(fullPath, 'utf8');
    const lines = sql.split('\n').length;

    // Extract database name from connection string
    const dbName = DATABASE_URL.split('/').pop().split('?')[0];
    const host = DATABASE_URL.split('@')[1]?.split('/')[0] || 'unknown';

    console.log(`📊 Database: ${dbName} @ ${host}`);
    console.log(`📝 Migration: ${path.basename(migrationFile)}`);
    console.log(`📏 Size: ${lines} lines, ${(sql.length / 1024).toFixed(1)} KB`);
    console.log('\n⚠️  WARNING: This will modify your production database!');
    console.log('Press Ctrl+C within 5 seconds to cancel...\n');

    // Give user 5 seconds to cancel
    for (let i = 5; i > 0; i--) {
      process.stdout.write(`\r${i}... `);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.log('\n');

    console.log('🚀 Running migration...\n');
    const startTime = Date.now();

    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✅ Migration completed successfully in ${duration}s!\n`);

    // Try to verify by checking if new tables exist
    console.log('🔍 Verifying migration...');
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name LIKE 'schedule%'
      ORDER BY table_name
    `);

    if (result.rows.length > 0) {
      console.log('✅ New tables created:');
      result.rows.forEach(row => console.log(`   - ${row.table_name}`));
    }

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
    console.log('\n🎉 All done!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration failed\n');
    process.exit(1);
  });
