#!/usr/bin/env node
/**
 * Production Seed Script - VERIFIED AGAINST ACTUAL SCHEMA
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL required');
  console.error('Usage: DATABASE_URL="postgresql://..." node seed-production.js');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function runSeed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    console.log('🌱 Starting database seeding...\n');

    // Check if demo users exist
    const existingUser = await client.query("SELECT id FROM users WHERE email = 'demo@buildpro.com'");
    if (existingUser.rows.length > 0) {
      console.log('⚠️  Demo users already exist. Skipping.');
      await client.query('ROLLBACK');
      return;
    }

    // Create users
    console.log('👤 Creating demo users...');
    const demoPassword = await bcrypt.hash('demo123', 10);
    const users = [];

    for (const user of [
      { first: 'John', last: 'Smith', email: 'demo@buildpro.com' },
      { first: 'Sarah', last: 'Johnson', email: 'sarah@buildpro.com' },
      { first: 'Mike', last: 'Chen', email: 'mike@buildpro.com' },
      { first: 'Emily', last: 'Davis', email: 'emily@buildpro.com' }
    ]) {
      const result = await client.query(
        'INSERT INTO users (first_name, last_name, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
        [user.first, user.last, user.email, demoPassword]
      );
      users.push(result.rows[0].id);
    }
    const [demoUserId, sarahId, mikeId, emilyId] = users;
    console.log('   ✓ Created 4 users (password: demo123)\n');

    // Create organization
    console.log('🏢 Creating organization...');
    const orgResult = await client.query(
      "INSERT INTO organizations (name, type) VALUES ('BuildPro LLC', 'gc') RETURNING id"
    );
    const orgId = orgResult.rows[0].id;
    console.log('   ✓ Created organization\n');

    // Create project
    console.log('🏗️  Creating project...');
    const projectResult = await client.query(
      `INSERT INTO projects (
        owner_organization_id, gc_organization_id, name, location, status,
        start_date, end_date, budget
      ) VALUES (
        $1, $1, 'Demo Construction Project',
        '{"address": "123 Main St, San Francisco, CA 94102"}'::jsonb,
        'active', CURRENT_DATE - INTERVAL '60 days',
        CURRENT_DATE + INTERVAL '180 days', 5500000
      ) RETURNING id`,
      [orgId]
    );
    const projectId = projectResult.rows[0].id;
    console.log('   ✓ Created project\n');

    // Add team members
    console.log('👥 Adding team members...');
    for (const [userId, role] of [
      [demoUserId, 'project_manager'],
      [sarahId, 'engineer'],
      [mikeId, 'superintendent'],
      [emilyId, 'subcontractor']
    ]) {
      await client.query(
        'INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)',
        [projectId, userId, role]
      );
    }
    console.log('   ✓ Added 4 team members\n');

    // Create RFIs
    console.log('📋 Creating RFIs...');
    await client.query(
      `INSERT INTO rfis (project_id, rfi_number, title, question, priority, status, created_by, assigned_to)
       VALUES
       ($1, 'RFI-001', 'Foundation Depth', 'Confirm foundation depth for grid A1-A5.', 'high', 'open', $2, $3),
       ($1, 'RFI-002', 'Electrical Panel', 'Panel location conflicts with HVAC.', 'urgent', 'open', $4, $2),
       ($1, 'RFI-003', 'Window Schedule', 'Window models discontinued.', 'normal', 'answered', $2, $3)`,
      [projectId, demoUserId, sarahId, mikeId]
    );
    console.log('   ✓ Created 3 RFIs\n');

    // Create punch items (WITH TRADE!)
    console.log('🔧 Creating punch items...');
    await client.query(
      `INSERT INTO punch_items (project_id, item_number, description, location, trade, priority, status, due_date, created_by, assigned_to)
       VALUES
       ($1, '001', 'Touch up paint', 'Lobby', 'Painting', 'low', 'open', CURRENT_DATE + 14, $2, $2),
       ($1, '002', 'Replace cracked tile', 'Suite 201', 'Flooring', 'high', 'open', CURRENT_DATE + 7, $2, $2),
       ($1, '003', 'Fix leaking faucet', 'Restroom', 'Plumbing', 'high', 'completed', CURRENT_DATE - 2, $2, $2)`,
      [projectId, demoUserId]
    );
    console.log('   ✓ Created 3 punch items\n');

    // Create budget lines (cost_code, budgeted_amount!)
    console.log('💰 Creating budget lines...');
    await client.query(
      `INSERT INTO budget_lines (project_id, cost_code, description, category, budgeted_amount)
       VALUES
       ($1, '01000', 'General Conditions', 'General', 450000),
       ($1, '03000', 'Concrete', 'Materials', 850000),
       ($1, '05000', 'Metals', 'Materials', 1200000),
       ($1, '09000', 'Finishes', 'Materials', 950000),
       ($1, '15000', 'Mechanical', 'Subcontractor', 1100000),
       ($1, '16000', 'Electrical', 'Subcontractor', 950000)`,
      [projectId]
    );
    console.log('   ✓ Created 6 budget lines\n');

    // Create vendor organization for commitments
    console.log('🏭 Creating vendor organization...');
    const vendorResult = await client.query(
      "INSERT INTO organizations (name, type) VALUES ('ABC Steel Co', 'subcontractor') RETURNING id"
    );
    const vendorId = vendorResult.rows[0].id;

    // Create commitments (title, total_amount, vendor_organization_id!)
    console.log('📝 Creating commitments...');
    await client.query(
      `INSERT INTO commitments (project_id, commitment_number, vendor_organization_id, title, type, total_amount, status, created_by)
       VALUES
       ($1, 'CO-001', $2, 'Structural Steel', 'subcontract', 1150000, 'approved', $3),
       ($1, 'CO-002', $2, 'Concrete Supply', 'purchase_order', 780000, 'approved', $3)`,
      [projectId, vendorId, demoUserId]
    );
    console.log('   ✓ Created 2 commitments\n');

    // Create schedule tasks
    console.log('📊 Creating schedule tasks...');
    await client.query(
      `INSERT INTO schedule_tasks (project_id, name, description, planned_start_date, planned_end_date, duration_days, status, priority, created_by)
       VALUES
       ($1, 'Site Preparation', 'Clear and grade', CURRENT_DATE - 50, CURRENT_DATE - 43, 7, 'completed', 'high', $2),
       ($1, 'Foundation Work', 'Excavate and pour', CURRENT_DATE - 42, CURRENT_DATE - 28, 14, 'completed', 'critical', $2),
       ($1, 'Structural Steel', 'Erect frame', CURRENT_DATE - 27, CURRENT_DATE - 6, 21, 'completed', 'critical', $2),
       ($1, 'Exterior Walls', 'Install panels', CURRENT_DATE - 5, CURRENT_DATE + 15, 20, 'in_progress', 'high', $2),
       ($1, 'MEP Rough-In', 'Mech/Elec/Plumb', CURRENT_DATE + 10, CURRENT_DATE + 38, 28, 'not_started', 'high', $2)`,
      [projectId, demoUserId]
    );
    console.log('   ✓ Created 5 schedule tasks\n');

    // Create milestones
    console.log('🎯 Creating milestones...');
    await client.query(
      `INSERT INTO schedule_milestones (project_id, name, description, target_date, status, created_by)
       VALUES
       ($1, 'Foundation Complete', 'Foundation done', CURRENT_DATE - 28, 'achieved', $2),
       ($1, 'Building Dried-In', 'Exterior complete', CURRENT_DATE + 15, 'pending', $2),
       ($1, 'Final Completion', 'All work complete', CURRENT_DATE + 90, 'pending', $2)`,
      [projectId, demoUserId]
    );
    console.log('   ✓ Created 3 milestones\n');

    await client.query('COMMIT');

    console.log('✅ Seeding completed!\n');
    console.log('='.repeat(60));
    console.log('📊 DEMO DATA SUMMARY');
    console.log('='.repeat(60));
    console.log('Login credentials (password: demo123):');
    console.log('  • demo@buildpro.com - John Smith');
    console.log('  • sarah@buildpro.com - Sarah Johnson');
    console.log('  • mike@buildpro.com - Mike Chen');
    console.log('  • emily@buildpro.com - Emily Davis');
    console.log('');
    console.log('Project: Demo Construction Project');
    console.log('Budget: $5,500,000');
    console.log('Data: 3 RFIs, 3 Punch Items, 6 Budget Lines,');
    console.log('      2 Commitments, 5 Tasks, 3 Milestones');
    console.log('='.repeat(60));
    console.log('\n🎉 Log in with demo@buildpro.com / demo123\n');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', error.message);
    console.error(error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runSeed()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
