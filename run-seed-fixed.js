#!/usr/bin/env node
/**
 * Run Seed Script - Fixed for actual production schema
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Error: DATABASE_URL environment variable is required');
  process.exit(1);
}

const sslConfig = DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: sslConfig
});

async function runSeed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('🌱 Starting database seeding...\n');

    // Check if demo users already exist
    const existingUser = await client.query(
      "SELECT id FROM users WHERE email = 'demo@buildpro.com'"
    );

    if (existingUser.rows.length > 0) {
      console.log('⚠️  Demo users already exist. Skipping seed.');
      console.log('   User demo@buildpro.com already exists.\n');
      await client.query('ROLLBACK');
      return;
    }

    // Create demo users
    console.log('👤 Creating demo users...');
    const demoPassword = await bcrypt.hash('demo123', 10);

    const users = [];
    const userEmails = [
      { firstName: 'John', lastName: 'Smith', email: 'demo@buildpro.com' },
      { firstName: 'Sarah', lastName: 'Johnson', email: 'sarah@buildpro.com' },
      { firstName: 'Mike', lastName: 'Chen', email: 'mike@buildpro.com' },
      { firstName: 'Emily', lastName: 'Davis', email: 'emily@buildpro.com' }
    ];

    for (const user of userEmails) {
      const result = await client.query(
        `INSERT INTO users (first_name, last_name, email, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id, first_name, last_name, email`,
        [user.firstName, user.lastName, user.email, demoPassword]
      );
      users.push(result.rows[0]);
    }

    const [demoUser, sarah, mike, emily] = users;
    console.log(`   ✓ Created ${users.length} users`);
    console.log(`   📧 Demo login: demo@buildpro.com / demo123\n`);

    // Create demo organization
    console.log('🏢 Creating demo organization...');
    const orgResult = await client.query(
      `INSERT INTO organizations (name, type)
       VALUES ('BuildPro Construction LLC', 'gc')
       RETURNING id`,
      []
    );
    const orgId = orgResult.rows[0].id;
    console.log(`   ✓ Created organization\n`);

    // Create demo project
    console.log('🏗️  Creating demo project...');
    const projectResult = await client.query(
      `INSERT INTO projects (
         name,
         owner_organization_id,
         gc_organization_id,
         location,
         status,
         start_date,
         end_date,
         budget
       )
       VALUES (
         'Demo Construction Project',
         $1,
         $1,
         '{"address": "123 Main Street, San Francisco, CA 94102"}'::jsonb,
         'active',
         CURRENT_DATE - INTERVAL '60 days',
         CURRENT_DATE + INTERVAL '180 days',
         5500000
       )
       RETURNING id`,
      [orgId]
    );
    const projectId = projectResult.rows[0].id;
    console.log(`   ✓ Created project: Demo Construction Project\n`);

    // Add team members
    console.log('👥 Adding team members...');
    await client.query(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES
         ($1, $2, 'project_manager'),
         ($1, $3, 'engineer'),
         ($1, $4, 'superintendent'),
         ($1, $5, 'subcontractor')`,
      [projectId, demoUser.id, sarah.id, mike.id, emily.id]
    );
    console.log(`   ✓ Added 4 team members\n`);

    // Create RFIs
    console.log('📋 Creating RFIs...');
    await client.query(
      `INSERT INTO rfis (project_id, rfi_number, title, question, priority, status, created_by, assigned_to)
       VALUES
         ($1, 'RFI-001', 'Foundation Depth', 'Please confirm foundation depth for grid lines A1-A5.', 'high', 'open', $2, $3),
         ($1, 'RFI-002', 'Electrical Panel', 'Panel location conflicts with mechanical equipment.', 'urgent', 'open', $4, $2),
         ($1, 'RFI-003', 'Window Schedule', 'Window models discontinued.', 'normal', 'answered', $2, $3)`,
      [projectId, demoUser.id, sarah.id, mike.id]
    );
    console.log(`   ✓ Created 3 RFIs\n`);

    // Create punch items
    console.log('🔧 Creating punch items...');
    await client.query(
      `INSERT INTO punch_items (project_id, item_number, description, location, trade, priority, status, due_date, created_by, assigned_to)
       VALUES
         ($1, 1, 'Touch up paint on wall', 'Lobby', 'Painting', 'low', 'open', CURRENT_DATE + INTERVAL '14 days', $2, $2),
         ($1, 2, 'Replace cracked floor tile', 'Suite 201', 'Flooring', 'high', 'open', CURRENT_DATE + INTERVAL '7 days', $2, $2),
         ($1, 3, 'Fix leaking faucet', 'Restroom', 'Plumbing', 'high', 'completed', CURRENT_DATE - INTERVAL '2 days', $2, $2)`,
      [projectId, demoUser.id]
    );
    console.log(`   ✓ Created 3 punch items\n`);

    // Create budget lines
    console.log('💰 Creating budget lines...');
    await client.query(
      `INSERT INTO budget_lines (project_id, code, description, budget_amount, created_by)
       VALUES
         ($1, '01000', 'General Conditions', 450000, $2),
         ($1, '03000', 'Concrete', 850000, $2),
         ($1, '05000', 'Metals', 1200000, $2),
         ($1, '09000', 'Finishes', 950000, $2),
         ($1, '15000', 'Mechanical', 1100000, $2),
         ($1, '16000', 'Electrical', 950000, $2)`,
      [projectId, demoUser.id]
    );
    console.log(`   ✓ Created 6 budget lines\n`);

    // Create commitments
    console.log('📝 Creating commitments...');
    await client.query(
      `INSERT INTO commitments (project_id, commitment_number, vendor_name, description, amount, commitment_date, status, created_by)
       VALUES
         ($1, 'CO-001', 'ABC Steel Company', 'Structural steel fabrication and installation', 1150000, CURRENT_DATE - INTERVAL '30 days', 'approved', $2),
         ($1, 'CO-002', 'XYZ Concrete Supply', 'Concrete materials and pumping', 780000, CURRENT_DATE - INTERVAL '25 days', 'approved', $2)`,
      [projectId, demoUser.id]
    );
    console.log(`   ✓ Created 2 commitments\n`);

    // Create schedule tasks
    console.log('📊 Creating schedule tasks...');
    await client.query(
      `INSERT INTO schedule_tasks (project_id, name, description, planned_start_date, planned_end_date, duration_days, status, priority, created_by)
       VALUES
         ($1, 'Site Preparation', 'Clear and grade site', CURRENT_DATE - INTERVAL '50 days', CURRENT_DATE - INTERVAL '43 days', 7, 'completed', 'high', $2),
         ($1, 'Foundation Work', 'Excavate and pour foundation', CURRENT_DATE - INTERVAL '42 days', CURRENT_DATE - INTERVAL '28 days', 14, 'completed', 'critical', $2),
         ($1, 'Structural Steel', 'Erect structural steel frame', CURRENT_DATE - INTERVAL '27 days', CURRENT_DATE - INTERVAL '6 days', 21, 'completed', 'critical', $2),
         ($1, 'Exterior Walls', 'Install exterior wall panels', CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE + INTERVAL '15 days', 20, 'in_progress', 'high', $2),
         ($1, 'MEP Rough-In', 'Mechanical, electrical, plumbing rough-in', CURRENT_DATE + INTERVAL '10 days', CURRENT_DATE + INTERVAL '38 days', 28, 'not_started', 'high', $2)`,
      [projectId, demoUser.id]
    );
    console.log(`   ✓ Created 5 schedule tasks\n`);

    // Create milestones
    console.log('🎯 Creating milestones...');
    await client.query(
      `INSERT INTO schedule_milestones (project_id, name, description, target_date, status, created_by)
       VALUES
         ($1, 'Foundation Complete', 'Foundation work completed and inspected', CURRENT_DATE - INTERVAL '28 days', 'achieved', $2),
         ($1, 'Building Dried-In', 'Exterior envelope weather-tight', CURRENT_DATE + INTERVAL '15 days', 'pending', $2),
         ($1, 'Final Completion', 'All work complete and ready for occupancy', CURRENT_DATE + INTERVAL '90 days', 'pending', $2)`,
      [projectId, demoUser.id]
    );
    console.log(`   ✓ Created 3 milestones\n`);

    await client.query('COMMIT');

    console.log('✅ Database seeding completed successfully!\n');
    console.log('='.repeat(60));
    console.log('📊 SEED DATA SUMMARY');
    console.log('='.repeat(60));
    console.log(`Project: Demo Construction Project (ID: ${projectId})`);
    console.log(`Budget: $5,500,000`);
    console.log('');
    console.log('Users created (all with password: demo123):');
    console.log('  • demo@buildpro.com - John Smith');
    console.log('  • sarah@buildpro.com - Sarah Johnson');
    console.log('  • mike@buildpro.com - Mike Chen');
    console.log('  • emily@buildpro.com - Emily Davis');
    console.log('');
    console.log('Data populated:');
    console.log('  • 3 RFIs');
    console.log('  • 3 Punch items');
    console.log('  • 6 Budget lines ($5,500,000 total)');
    console.log('  • 2 Commitments ($1,930,000 committed)');
    console.log('  • 5 Schedule tasks');
    console.log('  • 3 Milestones');
    console.log('='.repeat(60));
    console.log('');
    console.log('🎉 Log in with demo@buildpro.com / demo123\n');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error seeding database:', error.message);
    console.error(error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runSeed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
