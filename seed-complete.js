#!/usr/bin/env node
/**
 * COMPLETE Production Seed Script - All 11 Modules with Relationships
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL required');
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
    console.log('🌱 Starting COMPLETE database seeding...\n');

    // Check if demo users exist
    const existingUser = await client.query("SELECT id FROM users WHERE email = 'demo@buildpro.com'");
    if (existingUser.rows.length > 0) {
      console.log('⚠️  Demo users already exist. Skipping.');
      await client.query('ROLLBACK');
      return;
    }

    // ========================================================================
    // USERS
    // ========================================================================
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
    console.log('   ✓ Created 4 users\n');

    // ========================================================================
    // ORGANIZATION & PROJECT
    // ========================================================================
    console.log('🏢 Creating organization...');
    const orgResult = await client.query(
      "INSERT INTO organizations (name, type) VALUES ('BuildPro LLC', 'gc') RETURNING id"
    );
    const orgId = orgResult.rows[0].id;

    const vendorResult = await client.query(
      "INSERT INTO organizations (name, type) VALUES ('ABC Steel Co', 'subcontractor') RETURNING id"
    );
    const vendorId = vendorResult.rows[0].id;
    console.log('   ✓ Created 2 organizations\n');

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

    // ========================================================================
    // DOCUMENTS (metadata only - files don't exist)
    // ========================================================================
    console.log('📄 Creating documents (metadata only)...');
    const documentIds = [];
    const documents = [
      { name: 'Project Plans - Architectural.pdf', size: 2456789, mime: 'application/pdf' },
      { name: 'Building Permit Application.pdf', size: 1234567, mime: 'application/pdf' },
      { name: 'Safety Plan 2024.pdf', size: 987654, mime: 'application/pdf' },
      { name: 'Contract - General Contractor.pdf', size: 3456789, mime: 'application/pdf' },
      { name: 'Weekly Progress Report.pdf', size: 654321, mime: 'application/pdf' },
      { name: 'Site Photo 1.jpg', size: 524288, mime: 'image/jpeg' },
      { name: 'Site Photo 2.jpg', size: 612352, mime: 'image/jpeg' },
      { name: 'Site Photo 3.jpg', size: 589824, mime: 'image/jpeg' }
    ];

    for (const doc of documents) {
      const timestamp = Date.now();
      const result = await client.query(
        `INSERT INTO documents (project_id, name, file_path, file_size, mime_type, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [projectId, doc.name, `demo-${timestamp}-${Math.random().toString(36).substr(2, 9)}.pdf`, doc.size, doc.mime, demoUserId]
      );
      documentIds.push(result.rows[0].id);
    }
    console.log(`   ✓ Created ${documents.length} documents (files not included)\n`);

    // ========================================================================
    // DRAWING SETS & SHEETS
    // ========================================================================
    console.log('📐 Creating drawing sets...');
    const drawingSetResult = await client.query(
      `INSERT INTO drawing_sets (project_id, name, discipline, set_number, issue_date, revision, status, created_by)
       VALUES
       ($1, 'Architectural Plans', 'Architectural', 'A', CURRENT_DATE - 30, 'R2', 'issued', $2),
       ($1, 'Structural Plans', 'Structural', 'S', CURRENT_DATE - 25, 'R1', 'issued', $2),
       ($1, 'MEP Plans', 'MEP', 'M', CURRENT_DATE - 20, 'R1', 'issued', $2)
       RETURNING id`,
      [projectId, demoUserId]
    );
    const [archSetId, structSetId, mepSetId] = drawingSetResult.rows.map(r => r.id);

    // Create drawing sheets (without file links since we can't create actual PDFs)
    await client.query(
      `INSERT INTO drawing_sheets (drawing_set_id, sheet_number, title, discipline)
       VALUES
       ($1, 'A-101', 'Site Plan', 'Architectural'),
       ($1, 'A-201', 'Floor Plan - Level 1', 'Architectural'),
       ($1, 'A-301', 'Building Elevations', 'Architectural'),
       ($2, 'S-101', 'Foundation Plan', 'Structural'),
       ($2, 'S-201', 'Framing Plan', 'Structural'),
       ($3, 'M-101', 'HVAC Layout', 'MEP')`,
      [archSetId, structSetId, mepSetId]
    );
    console.log('   ✓ Created 3 drawing sets with 6 sheets\n');

    // ========================================================================
    // PHOTO ALBUMS & PHOTOS
    // ========================================================================
    console.log('📸 Creating photo albums...');
    const albumResult = await client.query(
      `INSERT INTO photo_albums (project_id, name, description, created_by)
       VALUES
       ($1, 'Site Progress - Foundation', 'Weekly progress photos of foundation work', $2),
       ($1, 'Safety Inspections', 'Safety inspection documentation', $2),
       ($1, 'Material Deliveries', 'Photos of material deliveries and storage', $2)
       RETURNING id`,
      [projectId, demoUserId]
    );
    const [foundationAlbumId, safetyAlbumId, materialAlbumId] = albumResult.rows.map(r => r.id);

    // Create photos (linked to documents and albums)
    await client.query(
      `INSERT INTO photos (album_id, project_id, document_id, title, description, taken_at, location, uploaded_by)
       VALUES
       ($1, $2, $3, 'Foundation Excavation', 'Excavation complete, ready for rebar', CURRENT_DATE - 40, '{"lat": 37.7749, "lng": -122.4194}'::jsonb, $4),
       ($1, $2, $5, 'Rebar Installation', 'Rebar placement in progress', CURRENT_DATE - 35, '{"lat": 37.7749, "lng": -122.4194}'::jsonb, $4),
       ($1, $2, $6, 'Foundation Pour', 'Concrete pour day 1', CURRENT_DATE - 30, '{"lat": 37.7749, "lng": -122.4194}'::jsonb, $4)`,
      [foundationAlbumId, projectId, documentIds[5], demoUserId, documentIds[6], documentIds[7]]
    );
    console.log('   ✓ Created 3 photo albums with 3 photos\n');

    // ========================================================================
    // SUBMITTAL PACKAGES & SUBMITTALS
    // ========================================================================
    console.log('📋 Creating submittal packages...');
    const submittalPkgResult = await client.query(
      `INSERT INTO submittal_packages (project_id, package_number, title, spec_section, created_by)
       VALUES
       ($1, 'SUB-001', 'Structural Steel Submittals', '05120', $2),
       ($1, 'SUB-002', 'Mechanical Equipment Submittals', '15000', $2)
       RETURNING id`,
      [projectId, demoUserId]
    );
    const [steelPkgId, mechPkgId] = submittalPkgResult.rows.map(r => r.id);

    // Create submittals
    const submittalResult = await client.query(
      `INSERT INTO submittals (package_id, submittal_number, title, type, status, submitted_by, submitted_at, due_date)
       VALUES
       ($1, '001', 'Steel beam specifications', 'shop_drawings', 'approved', $3, CURRENT_DATE - 20, CURRENT_DATE - 10),
       ($1, '002', 'Connection details', 'shop_drawings', 'approved_as_noted', $3, CURRENT_DATE - 15, CURRENT_DATE - 5),
       ($2, '001', 'HVAC equipment cut sheets', 'product_data', 'in_review', $3, CURRENT_DATE - 5, CURRENT_DATE + 5),
       ($2, '002', 'Ductwork shop drawings', 'shop_drawings', 'revise_resubmit', $3, CURRENT_DATE - 10, CURRENT_DATE)
       RETURNING id`,
      [steelPkgId, mechPkgId, emilyId]
    );
    const submittalIds = submittalResult.rows.map(r => r.id);

    // Add review steps for submittals
    await client.query(
      `INSERT INTO submittal_review_steps (submittal_id, step_number, reviewer_id, role, status, reviewed_at)
       VALUES
       ($1, 1, $2, 'architect', 'approved', CURRENT_DATE - 8),
       ($3, 1, $2, 'architect', 'approved_as_noted', CURRENT_DATE - 3)`,
      [submittalIds[0], sarahId, submittalIds[1]]
    );
    console.log('   ✓ Created 2 submittal packages with 4 submittals\n');

    // ========================================================================
    // DAILY LOGS
    // ========================================================================
    console.log('📅 Creating daily logs...');
    const dailyLogResult = await client.query(
      `INSERT INTO daily_logs (project_id, log_date, weather, work_performed, delays, is_submitted, created_by)
       VALUES
       ($1, CURRENT_DATE - 3, '{"temperature": 68, "conditions": "Sunny", "wind": "5 mph NW"}'::jsonb,
        'Foundation work continued. Poured north wall section. Total 45 cubic yards.',
        'No delays', true, $2),
       ($1, CURRENT_DATE - 2, '{"temperature": 72, "conditions": "Partly cloudy", "wind": "10 mph W"}'::jsonb,
        'Steel erection began. Placed 12 columns on grid lines A-D.',
        '2 hour delay waiting for crane', true, $2),
       ($1, CURRENT_DATE - 1, '{"temperature": 70, "conditions": "Clear", "wind": "8 mph SW"}'::jsonb,
        'Continued steel erection. Installed beams for level 2 framing.',
        'No delays', true, $2)
       RETURNING id`,
      [projectId, mikeId]
    );
    const dailyLogIds = dailyLogResult.rows.map(r => r.id);

    // Add manpower to daily logs
    await client.query(
      `INSERT INTO daily_log_manpower (daily_log_id, trade, company_name, worker_count, hours_worked)
       VALUES
       ($1, 'Laborers', 'ABC Construction', 8, 64.0),
       ($1, 'Concrete', 'XYZ Concrete', 4, 32.0),
       ($2, 'Ironworkers', 'Steel Pros Inc', 6, 48.0),
       ($3, 'Ironworkers', 'Steel Pros Inc', 6, 48.0)`,
      [dailyLogIds[0], dailyLogIds[1], dailyLogIds[2]]
    );
    console.log('   ✓ Created 3 daily logs with manpower\n');

    // ========================================================================
    // RFIs (with drawing links)
    // ========================================================================
    console.log('📋 Creating RFIs...');
    const rfiResult = await client.query(
      `INSERT INTO rfis (project_id, rfi_number, title, question, priority, status, created_by, assigned_to, drawing_sheet_id)
       VALUES
       ($1, 'RFI-001', 'Foundation Depth', 'Confirm foundation depth for grid A1-A5. Drawing shows 8ft but soils report recommends 10ft.', 'high', 'open', $2, $3,
        (SELECT id FROM drawing_sheets WHERE sheet_number = 'S-101' LIMIT 1)),
       ($1, 'RFI-002', 'Electrical Panel Location', 'Panel location on M-101 conflicts with HVAC unit. Need coordination.', 'urgent', 'open', $4, $2,
        (SELECT id FROM drawing_sheets WHERE sheet_number = 'M-101' LIMIT 1)),
       ($1, 'RFI-003', 'Window Schedule', 'Window models on A-301 are discontinued. Provide approved alternatives.', 'normal', 'answered', $2, $3,
        (SELECT id FROM drawing_sheets WHERE sheet_number = 'A-301' LIMIT 1))
       RETURNING id`,
      [projectId, demoUserId, sarahId, mikeId]
    );
    const rfiIds = rfiResult.rows.map(r => r.id);

    // Add RFI responses
    await client.query(
      `INSERT INTO rfi_responses (rfi_id, response_text, is_official, responded_by, responded_at)
       VALUES ($1, 'Foundation depth should be 10 feet per soils report. Drawing S-101 will be revised.', true, $2, CURRENT_DATE - 2)`,
      [rfiIds[2], sarahId]
    );
    console.log('   ✓ Created 3 RFIs (linked to drawings)\n');

    // ========================================================================
    // PUNCH ITEMS
    // ========================================================================
    console.log('🔧 Creating punch items...');
    await client.query(
      `INSERT INTO punch_items (project_id, item_number, description, location, trade, priority, status, due_date, created_by, assigned_to)
       VALUES
       ($1, '001', 'Touch up paint on drywall', 'Suite 201', 'Painting', 'low', 'open', CURRENT_DATE + 14, $2, $3),
       ($1, '002', 'Replace cracked floor tile', 'Lobby', 'Flooring', 'high', 'open', CURRENT_DATE + 7, $2, $3),
       ($1, '003', 'Fix leaking faucet', 'Restroom 1A', 'Plumbing', 'high', 'completed', CURRENT_DATE - 2, $2, $4),
       ($1, '004', 'Adjust door alignment', 'Suite 105', 'Carpentry', 'normal', 'in_progress', CURRENT_DATE + 5, $2, $3),
       ($1, '005', 'Clean roof debris', 'Roof', 'General', 'low', 'completed', CURRENT_DATE - 5, $2, $3)`,
      [projectId, demoUserId, emilyId, mikeId]
    );
    console.log('   ✓ Created 5 punch items\n');

    // ========================================================================
    // FINANCIALS
    // ========================================================================
    console.log('💰 Creating budget lines...');
    await client.query(
      `INSERT INTO budget_lines (project_id, cost_code, description, category, budgeted_amount, committed_amount, invoiced_amount)
       VALUES
       ($1, '01000', 'General Conditions', 'General', 450000, 120000, 60000),
       ($1, '03000', 'Concrete', 'Materials', 850000, 780000, 520000),
       ($1, '05000', 'Metals', 'Materials', 1200000, 1150000, 575000),
       ($1, '09000', 'Finishes', 'Materials', 950000, 0, 0),
       ($1, '15000', 'Mechanical', 'Subcontractor', 1100000, 980000, 0),
       ($1, '16000', 'Electrical', 'Subcontractor', 950000, 0, 0)`,
      [projectId]
    );

    await client.query(
      `INSERT INTO commitments (project_id, commitment_number, vendor_organization_id, title, type, total_amount, status, start_date, end_date, created_by)
       VALUES
       ($1, 'CO-001', $2, 'Structural Steel Fabrication & Erection', 'subcontract', 1150000, 'approved', CURRENT_DATE - 30, CURRENT_DATE + 60, $3),
       ($1, 'CO-002', $2, 'Concrete Supply & Placement', 'purchase_order', 780000, 'executed', CURRENT_DATE - 40, CURRENT_DATE + 30, $3),
       ($1, 'CO-003', $2, 'HVAC Equipment & Installation', 'subcontract', 980000, 'approved', CURRENT_DATE - 10, CURRENT_DATE + 90, $3)`,
      [projectId, vendorId, demoUserId]
    );
    console.log('   ✓ Created 6 budget lines & 3 commitments\n');

    // ========================================================================
    // SCHEDULE
    // ========================================================================
    console.log('📊 Creating schedule tasks...');
    const taskResult = await client.query(
      `INSERT INTO schedule_tasks (project_id, name, description, planned_start_date, planned_end_date, duration_days, status, priority, created_by)
       VALUES
       ($1, 'Site Preparation', 'Clear and grade site', CURRENT_DATE - 50, CURRENT_DATE - 43, 7, 'completed', 'high', $2),
       ($1, 'Foundation Work', 'Excavate and pour foundation', CURRENT_DATE - 42, CURRENT_DATE - 28, 14, 'completed', 'critical', $2),
       ($1, 'Structural Steel Erection', 'Erect steel frame', CURRENT_DATE - 27, CURRENT_DATE - 6, 21, 'completed', 'critical', $2),
       ($1, 'Exterior Wall Installation', 'Install exterior panels', CURRENT_DATE - 5, CURRENT_DATE + 15, 20, 'in_progress', 'high', $2),
       ($1, 'MEP Rough-In', 'Mechanical, electrical, plumbing rough-in', CURRENT_DATE + 10, CURRENT_DATE + 38, 28, 'not_started', 'high', $2),
       ($1, 'Interior Finishes', 'Drywall, paint, flooring', CURRENT_DATE + 40, CURRENT_DATE + 70, 30, 'not_started', 'normal', $2)
       RETURNING id`,
      [projectId, demoUserId]
    );
    const taskIds = taskResult.rows.map(r => r.id);

    // Add task dependencies
    await client.query(
      `INSERT INTO task_dependencies (predecessor_task_id, successor_task_id, dependency_type, lag_days)
       VALUES
       ($1, $2, 'FS', 0),
       ($2, $3, 'FS', 0),
       ($3, $4, 'FS', 0),
       ($4, $5, 'FS', 5),
       ($5, $6, 'FS', 2)`,
      [taskIds[0], taskIds[1], taskIds[2], taskIds[3], taskIds[4], taskIds[5]]
    );

    await client.query(
      `INSERT INTO schedule_milestones (project_id, name, description, target_date, status, related_task_id, created_by)
       VALUES
       ($1, 'Foundation Complete', 'Foundation work completed and inspected', CURRENT_DATE - 28, 'achieved', $2, $3),
       ($1, 'Steel Frame Complete', 'Structural steel fully erected', CURRENT_DATE - 6, 'achieved', $4, $3),
       ($1, 'Building Dried-In', 'Exterior envelope weather-tight', CURRENT_DATE + 15, 'pending', $5, $3),
       ($1, 'MEP Complete', 'All MEP systems installed', CURRENT_DATE + 38, 'pending', $6, $3),
       ($1, 'Substantial Completion', 'Project substantially complete', CURRENT_DATE + 70, 'pending', $7, $3),
       ($1, 'Final Completion', 'All work complete, ready for occupancy', CURRENT_DATE + 90, 'pending', NULL, $3)`,
      [projectId, taskIds[1], demoUserId, taskIds[2], taskIds[3], taskIds[4], taskIds[5]]
    );
    console.log('   ✓ Created 6 schedule tasks (with dependencies) & 6 milestones\n');

    // ========================================================================
    // CROSS-MODULE LINKS
    // ========================================================================
    console.log('🔗 Creating cross-module links...');

    // Link RFIs to Schedule Tasks
    await client.query(
      `INSERT INTO schedule_links (task_id, entity_type, entity_id, link_type, schedule_impact_days, created_by)
       VALUES
       ($1, 'rfi', $2, 'blocks', 3, $3),
       ($4, 'submittal', $5, 'requires', 0, $3)`,
      [taskIds[1], rfiIds[0], demoUserId, taskIds[2], submittalIds[0]]
    );
    console.log('   ✓ Linked RFIs and submittals to schedule tasks\n');

    await client.query('COMMIT');

    console.log('✅ COMPLETE seeding finished!\n');
    console.log('='.repeat(70));
    console.log('📊 COMPREHENSIVE DEMO DATA SUMMARY');
    console.log('='.repeat(70));
    console.log('Login credentials (password: demo123):');
    console.log('  • demo@buildpro.com - John Smith (Project Manager)');
    console.log('  • sarah@buildpro.com - Sarah Johnson (Engineer)');
    console.log('  • mike@buildpro.com - Mike Chen (Superintendent)');
    console.log('  • emily@buildpro.com - Emily Davis (Subcontractor)');
    console.log('');
    console.log('Project: Demo Construction Project');
    console.log('Budget: $5,500,000 | Timeline: 240 days');
    console.log('');
    console.log('📦 Data Created:');
    console.log('  • 8 Documents (metadata only - actual files not included)');
    console.log('  • 3 Drawing Sets with 6 Sheets');
    console.log('  • 3 Photo Albums with 3 Photos');
    console.log('  • 2 Submittal Packages with 4 Submittals');
    console.log('  • 3 Daily Logs with manpower tracking');
    console.log('  • 3 RFIs (linked to drawing sheets)');
    console.log('  • 5 Punch Items');
    console.log('  • 6 Budget Lines with $2.9M committed');
    console.log('  • 3 Commitments (POs and subcontracts)');
    console.log('  • 6 Schedule Tasks with dependencies');
    console.log('  • 6 Milestones (2 achieved, 4 pending)');
    console.log('  • Cross-module links (RFIs → Tasks, Submittals → Tasks)');
    console.log('='.repeat(70));
    console.log('\n🎉 Log in with demo@buildpro.com / demo123 to explore!\n');

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
