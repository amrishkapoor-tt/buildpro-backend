#!/usr/bin/env node
/**
 * Clear Demo Data Script
 * Removes all demo users and their associated projects
 */

require('dotenv').config();
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL required');
  console.error('Usage: DATABASE_URL="postgresql://..." node clear-demo-data.js');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function clearDemoData() {
  const client = await pool.connect();

  try {
    console.log('🧹 Clearing demo data...\n');

    await client.query('BEGIN');

    // Check if demo users exist
    const demoUsers = await client.query(
      "SELECT id, email FROM users WHERE email IN ('demo@buildpro.com', 'sarah@buildpro.com', 'mike@buildpro.com', 'emily@buildpro.com')"
    );

    if (demoUsers.rows.length === 0) {
      console.log('ℹ️  No demo users found. Nothing to clear.\n');
      await client.query('ROLLBACK');
      return;
    }

    console.log(`Found ${demoUsers.rows.length} demo users:`);
    demoUsers.rows.forEach(u => console.log(`  • ${u.email}`));
    console.log('');

    // Delete demo projects (cascade will handle all related data)
    const projectsDeleted = await client.query(
      "DELETE FROM projects WHERE name = 'Demo Construction Project' RETURNING id, name"
    );

    if (projectsDeleted.rows.length > 0) {
      console.log(`✓ Deleted ${projectsDeleted.rows.length} demo project(s)`);
      projectsDeleted.rows.forEach(p => console.log(`  • ${p.name}`));
    } else {
      console.log('ℹ️  No demo projects found');
    }

    // Delete demo organizations
    const orgsDeleted = await client.query(
      "DELETE FROM organizations WHERE name IN ('BuildPro LLC', 'ABC Steel Co') RETURNING id, name"
    );

    if (orgsDeleted.rows.length > 0) {
      console.log(`✓ Deleted ${orgsDeleted.rows.length} demo organization(s)`);
      orgsDeleted.rows.forEach(o => console.log(`  • ${o.name}`));
    }

    // Delete demo users
    const usersDeleted = await client.query(
      "DELETE FROM users WHERE email IN ('demo@buildpro.com', 'sarah@buildpro.com', 'mike@buildpro.com', 'emily@buildpro.com') RETURNING id, email"
    );

    console.log(`✓ Deleted ${usersDeleted.rows.length} demo user(s)`);
    usersDeleted.rows.forEach(u => console.log(`  • ${u.email}`));

    await client.query('COMMIT');

    console.log('\n✅ Demo data cleared successfully!\n');
    console.log('You can now run seed-complete.js to create fresh demo data.\n');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ Error clearing demo data:', error.message);
    console.error(error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

clearDemoData()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
