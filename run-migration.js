#!/usr/bin/env node
/**
 * Migration Runner
 *
 * Usage:
 *   node run-migration.js migrations/006_scheduling_system.sql
 *
 * Runs a SQL migration file against the production database.
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('❌ Error: Please provide a migration file');
  console.error('Usage: node run-migration.js migrations/006_scheduling_system.sql');
  process.exit(1);
}

const fullPath = path.resolve(__dirname, migrationFile);
if (!fs.existsSync(fullPath)) {
  console.error(`❌ Error: Migration file not found: ${fullPath}`);
  process.exit(1);
}

// Determine if we need SSL (true for remote databases like Render)
const isRemoteDatabase = process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isRemoteDatabase ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  const client = await pool.connect();

  try {
    console.log('🔄 Reading migration file...');
    const sql = fs.readFileSync(fullPath, 'utf8');

    console.log(`📊 Database: ${process.env.DATABASE_URL?.split('@')[1]?.split('/')[1] || 'Unknown'}`);
    console.log(`📝 Migration: ${path.basename(migrationFile)}`);
    console.log('\n⚠️  WARNING: This will modify your production database!');
    console.log('Press Ctrl+C within 5 seconds to cancel...\n');

    // Give user 5 seconds to cancel
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('🚀 Running migration...\n');

    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');

    console.log('✅ Migration completed successfully!\n');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error.message);
    console.error('\nFull error:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
