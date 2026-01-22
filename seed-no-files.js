#!/usr/bin/env node
/**
 * Production Seed Script - No Files Required
 * Creates demo data for all modules that don't need file uploads
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
    console.log('🌱 Starting database seeding (no files)...\n');

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
    console.log('🏢 Creating organizations...');
    const orgResult = await client.query(
      "INSERT INTO organizations (name, type) VALUES ('BuildPro LLC', 'gc') RETURNING id"
    );
    const orgId = orgResult.rows[0].id;

    const vendorResult = await client.query(
      "INSERT INTO organizations (name, type) VALUES ('ABC Steel Co', 'subcontractor') RETURNING id"
    );
    const vendorId = vendorResult.rows[0].id;

    const mechVendorResult = await client.query(
      "INSERT INTO organizations (name, type) VALUES ('Elite Mechanical', 'subcontractor') RETURNING id"
    );
    const mechVendorId = mechVendorResult.rows[0].id;
    console.log('   ✓ Created 3 organizations\n');

    console.log('🏗️  Creating project...');
    const projectResult = await client.query(
      `INSERT INTO projects (
        owner_organization_id, gc_organization_id, name, location, status,
        start_date, end_date, budget
      ) VALUES (
        $1, $1, 'Demo Construction Project',
        '{"address": "123 Main Street, San Francisco, CA 94102"}'::jsonb,
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
    // RFIs
    // ========================================================================
    console.log('📋 Creating RFIs...');
    const rfiResult = await client.query(
      `INSERT INTO rfis (project_id, rfi_number, title, question, priority, status, created_by, assigned_to, cost_impact, schedule_impact)
       VALUES
       ($1, 'RFI-001', 'Foundation Depth Clarification', 'Please confirm the foundation depth for grid lines A1-A5. Drawings show conflicting dimensions between architectural and structural sets.', 'high', 'open', $2, $3, false, true),
       ($1, 'RFI-002', 'Electrical Panel Location Conflict', 'Electrical panel location on Level 2 conflicts with mechanical equipment placement. Need coordination between trades.', 'urgent', 'open', $4, $2, true, true),
       ($1, 'RFI-003', 'Window Schedule Revision Required', 'Window schedule shows models that have been discontinued by manufacturer. Please provide approved alternatives with equivalent performance.', 'normal', 'answered', $2, $3, false, false),
       ($1, 'RFI-004', 'Concrete Mix Design Verification', 'Confirm concrete mix design for elevated slab - specifications call for 3000 PSI but structural drawings note 4000 PSI.', 'high', 'answered', $4, $3, false, false),
       ($1, 'RFI-005', 'Stair Railing Detail Clarification', 'Detail 5/A3.1 is unclear regarding stair railing attachment to concrete. Need shop drawing approval process.', 'normal', 'closed', $2, $3, false, false)
       RETURNING id`,
      [projectId, demoUserId, sarahId, mikeId]
    );
    const rfiIds = rfiResult.rows.map(r => r.id);

    // Add RFI responses
    await client.query(
      `INSERT INTO rfi_responses (rfi_id, response_text, is_official, responded_by, responded_at)
       VALUES
       ($1, 'Foundation depth should be 10 feet below grade per soils report dated 2024-01-15. Structural drawing S-101 takes precedence. Architectural drawings will be revised in next submittal.', true, $2, CURRENT_DATE - 2),
       ($3, 'Use 4000 PSI concrete mix per structural requirements. Specification will be updated via addendum. Approved mix design attached to PCO-003.', true, $4, CURRENT_DATE - 5)`,
      [rfiIds[2], sarahId, rfiIds[3], sarahId]
    );
    console.log('   ✓ Created 5 RFIs with 2 responses\n');

    // ========================================================================
    // SUBMITTAL PACKAGES & SUBMITTALS
    // ========================================================================
    console.log('📋 Creating submittal packages...');
    const submittalPkgResult = await client.query(
      `INSERT INTO submittal_packages (project_id, package_number, title, spec_section, created_by)
       VALUES
       ($1, 'SUB-001', 'Structural Steel Submittals', '05120', $2),
       ($1, 'SUB-002', 'Mechanical Equipment Submittals', '15000', $2),
       ($1, 'SUB-003', 'Concrete Materials Submittals', '03300', $2)
       RETURNING id`,
      [projectId, demoUserId]
    );
    const [steelPkgId, mechPkgId, concretePkgId] = submittalPkgResult.rows.map(r => r.id);

    const submittalResult = await client.query(
      `INSERT INTO submittals (package_id, submittal_number, title, type, status, submitted_by, submitted_at, due_date)
       VALUES
       ($1, '001', 'Wide Flange Steel Beam Specifications', 'shop_drawings', 'approved', $4, CURRENT_DATE - 25, CURRENT_DATE - 15),
       ($1, '002', 'Steel Connection Details - Type A', 'shop_drawings', 'approved_as_noted', $4, CURRENT_DATE - 20, CURRENT_DATE - 10),
       ($1, '003', 'Steel Column Base Plates', 'shop_drawings', 'approved', $4, CURRENT_DATE - 18, CURRENT_DATE - 8),
       ($2, '001', 'HVAC Rooftop Unit Cut Sheets', 'product_data', 'in_review', $5, CURRENT_DATE - 7, CURRENT_DATE + 3),
       ($2, '002', 'Ductwork Shop Drawings - Levels 1-3', 'shop_drawings', 'revise_resubmit', $5, CURRENT_DATE - 12, CURRENT_DATE - 2),
       ($2, '003', 'Plumbing Fixture Schedule', 'product_data', 'submitted', $5, CURRENT_DATE - 3, CURRENT_DATE + 7),
       ($3, '001', 'Concrete Mix Design - Foundation', 'test_reports', 'approved', $4, CURRENT_DATE - 35, CURRENT_DATE - 30),
       ($3, '002', 'Ready-Mix Concrete Certifications', 'certificates', 'approved', $4, CURRENT_DATE - 30, CURRENT_DATE - 25)
       RETURNING id`,
      [steelPkgId, mechPkgId, concretePkgId, emilyId, mikeId]
    );
    const submittalIds = submittalResult.rows.map(r => r.id);

    // Add review steps
    await client.query(
      `INSERT INTO submittal_review_steps (submittal_id, step_number, reviewer_id, role, status, review_comments, reviewed_at)
       VALUES
       ($1, 1, $2, 'architect', 'approved', 'Approved as submitted. No exceptions.', CURRENT_DATE - 13),
       ($3, 1, $2, 'architect', 'approved_as_noted', 'Approved with notes: Verify weld sizes on connections C-12 through C-18. Resubmit calculations for review.', CURRENT_DATE - 8),
       ($4, 1, $2, 'architect', 'approved', 'Approved. Proceed with fabrication.', CURRENT_DATE - 6),
       ($5, 1, $2, 'architect', 'revise_resubmit', 'Revise and resubmit: Duct sizing conflicts with architectural ceiling heights in zones 2B and 3A. Coordinate with structural for routing.', CURRENT_DATE - 5)`,
      [submittalIds[0], sarahId, submittalIds[1], submittalIds[2], submittalIds[4]]
    );
    console.log('   ✓ Created 3 submittal packages with 8 submittals\n');

    // ========================================================================
    // DAILY LOGS
    // ========================================================================
    console.log('📅 Creating daily logs...');
    const dailyLogResult = await client.query(
      `INSERT INTO daily_logs (project_id, log_date, weather, work_performed, delays, is_submitted, submitted_by, created_by)
       VALUES
       ($1, CURRENT_DATE - 5, '{"temperature": 68, "conditions": "Sunny", "wind": "5 mph NW"}'::jsonb,
        'Foundation work continued on grid lines A-D. Poured north wall section totaling 45 cubic yards. Rebar inspection passed. Formwork stripped on south wall.',
        'No delays', true, $2, $2),
       ($1, CURRENT_DATE - 4, '{"temperature": 72, "conditions": "Partly cloudy", "wind": "10 mph W"}'::jsonb,
        'Steel erection began at 7:00 AM. Placed 12 columns on grid lines A-D. Crane certification verified. Safety meeting conducted at start of shift covering fall protection.',
        'Delayed 2 hours waiting for crane delivery due to traffic', true, $2, $2),
       ($1, CURRENT_DATE - 3, '{"temperature": 70, "conditions": "Clear", "wind": "8 mph SW"}'::jsonb,
        'Continued steel erection. Installed primary beams for Level 2 framing. Total of 18 beams placed. Bolting crew following behind setting connections. Quality control inspection passed.',
        'No delays', true, $2, $2),
       ($1, CURRENT_DATE - 2, '{"temperature": 75, "conditions": "Sunny", "wind": "12 mph S"}'::jsonb,
        'Completed Level 2 steel framing. MEP rough-in coordination meeting held on site. Concrete crew preparing for elevated slab pour next week. Material delivery of metal deck received.',
        '1 hour delay - concrete pump breakdown, backup pump deployed', true, $2, $2),
       ($1, CURRENT_DATE - 1, '{"temperature": 73, "conditions": "Partly cloudy", "wind": "7 mph SE"}'::jsonb,
        'Metal decking installation in progress on Level 2. Exterior wall panel installation began on west elevation. Safety inspection conducted - all items cleared. Weekly progress meeting held.',
        'No delays', true, $2, $2)
       RETURNING id`,
      [projectId, mikeId]
    );
    const dailyLogIds = dailyLogResult.rows.map(r => r.id);

    // Add manpower to daily logs
    await client.query(
      `INSERT INTO daily_log_manpower (daily_log_id, trade, company_name, worker_count, hours_worked)
       VALUES
       ($1, 'Laborers', 'ABC Construction', 8, 64.0),
       ($1, 'Concrete Finishers', 'XYZ Concrete', 4, 32.0),
       ($1, 'Carpenters', 'Woodwork Pros', 6, 48.0),
       ($2, 'Ironworkers', 'Steel Pros Inc', 6, 42.0),
       ($2, 'Crane Operators', 'Heavy Lift Co', 2, 14.0),
       ($2, 'Laborers', 'ABC Construction', 4, 32.0),
       ($3, 'Ironworkers', 'Steel Pros Inc', 8, 64.0),
       ($3, 'Laborers', 'ABC Construction', 6, 48.0),
       ($4, 'Ironworkers', 'Steel Pros Inc', 6, 48.0),
       ($4, 'Electricians', 'Elite Electric', 4, 32.0),
       ($4, 'Plumbers', 'Flow Masters', 3, 24.0),
       ($5, 'Ironworkers', 'Steel Pros Inc', 4, 32.0),
       ($5, 'Sheet Metal Workers', 'Metal Craft', 6, 48.0),
       ($5, 'Glaziers', 'Glass Experts', 4, 32.0)`,
      [dailyLogIds[0], dailyLogIds[1], dailyLogIds[2], dailyLogIds[3], dailyLogIds[4]]
    );
    console.log('   ✓ Created 5 daily logs with detailed manpower tracking\n');

    // ========================================================================
    // PUNCH ITEMS
    // ========================================================================
    console.log('🔧 Creating punch items...');
    await client.query(
      `INSERT INTO punch_items (project_id, item_number, description, location, trade, priority, status, due_date, created_by, assigned_to)
       VALUES
       ($1, '001', 'Touch up paint on drywall - multiple scuff marks', 'Suite 201, East Wall', 'Painting', 'low', 'open', CURRENT_DATE + 14, $2, $3),
       ($1, '002', 'Replace cracked floor tile (3 tiles)', 'Main Lobby, NE Corner', 'Flooring', 'high', 'open', CURRENT_DATE + 7, $2, $3),
       ($1, '003', 'Fix leaking faucet - dripping continuously', 'Restroom 1A, Second Stall', 'Plumbing', 'high', 'completed', CURRENT_DATE - 2, $2, $4),
       ($1, '004', 'Adjust door alignment - not closing properly', 'Suite 105, Entry Door', 'Carpentry', 'normal', 'in_progress', CURRENT_DATE + 5, $2, $3),
       ($1, '005', 'Clean roof debris and check drainage', 'Roof Level, All Drains', 'General', 'low', 'completed', CURRENT_DATE - 5, $2, $3),
       ($1, '006', 'Repair damaged drywall corner bead', 'Corridor 2B, Column Line C', 'Drywall', 'normal', 'open', CURRENT_DATE + 10, $2, $3),
       ($1, '007', 'Reset fire alarm pull station - tampered', 'Stairwell A, Level 3', 'Fire Protection', 'high', 'in_progress', CURRENT_DATE + 3, $2, $4),
       ($1, '008', 'Caulk window perimeter - air infiltration', 'Suite 210, South Windows', 'Glazing', 'normal', 'open', CURRENT_DATE + 12, $2, $3)`,
      [projectId, demoUserId, emilyId, mikeId]
    );
    console.log('   ✓ Created 8 punch items\n');

    // ========================================================================
    // FINANCIALS
    // ========================================================================
    console.log('💰 Creating budget lines...');
    await client.query(
      `INSERT INTO budget_lines (project_id, cost_code, description, category, budgeted_amount, committed_amount, invoiced_amount)
       VALUES
       ($1, '01000', 'General Conditions & Requirements', 'General', 450000, 120000, 60000),
       ($1, '02000', 'Site Construction & Earthwork', 'Sitework', 280000, 195000, 145000),
       ($1, '03000', 'Concrete', 'Materials', 850000, 780000, 520000),
       ($1, '04000', 'Masonry', 'Materials', 175000, 0, 0),
       ($1, '05000', 'Metals & Structural Steel', 'Materials', 1200000, 1150000, 575000),
       ($1, '06000', 'Wood, Plastics & Composites', 'Materials', 145000, 0, 0),
       ($1, '07000', 'Thermal & Moisture Protection', 'Materials', 320000, 0, 0),
       ($1, '08000', 'Openings (Doors & Windows)', 'Materials', 275000, 0, 0),
       ($1, '09000', 'Finishes', 'Materials', 950000, 0, 0),
       ($1, '15000', 'Mechanical', 'Subcontractor', 1100000, 980000, 0),
       ($1, '16000', 'Electrical', 'Subcontractor', 950000, 0, 0),
       ($1, '21000', 'Fire Suppression', 'Subcontractor', 185000, 0, 0)`,
      [projectId]
    );

    await client.query(
      `INSERT INTO commitments (project_id, commitment_number, vendor_organization_id, title, type, total_amount, status, start_date, end_date, created_by)
       VALUES
       ($1, 'PO-1001', $2, 'Structural Steel Fabrication & Erection', 'subcontract', 1150000, 'executed', CURRENT_DATE - 45, CURRENT_DATE + 45, $3),
       ($1, 'PO-1002', $2, 'Concrete Supply & Placement Services', 'purchase_order', 780000, 'executed', CURRENT_DATE - 50, CURRENT_DATE + 20, $3),
       ($1, 'PO-1003', $4, 'HVAC Equipment Supply & Installation', 'subcontract', 980000, 'approved', CURRENT_DATE - 10, CURRENT_DATE + 80, $3),
       ($1, 'PO-1004', $2, 'Site Earthwork & Grading', 'subcontract', 195000, 'executed', CURRENT_DATE - 60, CURRENT_DATE - 20, $3)`,
      [projectId, vendorId, demoUserId, mechVendorId]
    );

    // Create change orders
    await client.query(
      `INSERT INTO change_orders (project_id, change_order_number, title, description, cost_impact, status)
       VALUES
       ($1, 'PCO-001', 'Additional Structural Steel Support', 'Add supplemental steel beaming for increased loading per engineer directive. Includes material, fabrication, and installation.', 45000, 'approved'),
       ($1, 'PCO-002', 'Upgraded Lobby Flooring Material', 'Owner-requested upgrade from vinyl composite tile to porcelain tile in main lobby area (1,200 SF).', 28000, 'approved'),
       ($1, 'PCO-003', 'Foundation Depth Increase', 'Increase foundation depth per soils report recommendation and structural engineer requirement.', 62000, 'pending')`,
      [projectId]
    );

    console.log('   ✓ Created 12 budget lines, 4 commitments, 3 change orders\n');

    // ========================================================================
    // SCHEDULE
    // ========================================================================
    console.log('📊 Creating schedule tasks...');
    const taskResult = await client.query(
      `INSERT INTO schedule_tasks (project_id, name, description, planned_start_date, planned_end_date, duration_days, status, priority, percent_complete, created_by)
       VALUES
       ($1, 'Site Mobilization & Preparation', 'Clear and grade site, install temporary facilities', CURRENT_DATE - 55, CURRENT_DATE - 48, 7, 'completed', 'high', 100, $2),
       ($1, 'Excavation & Earthwork', 'Mass excavation and site grading per civil plans', CURRENT_DATE - 47, CURRENT_DATE - 43, 4, 'completed', 'critical', 100, $2),
       ($1, 'Foundation Work', 'Excavate footings, place rebar and forms, pour concrete', CURRENT_DATE - 42, CURRENT_DATE - 28, 14, 'completed', 'critical', 100, $2),
       ($1, 'Underground Utilities', 'Install underground MEP utilities and connections', CURRENT_DATE - 35, CURRENT_DATE - 29, 6, 'completed', 'high', 100, $2),
       ($1, 'Structural Steel Erection', 'Erect structural steel frame for all levels', CURRENT_DATE - 27, CURRENT_DATE - 6, 21, 'completed', 'critical', 100, $2),
       ($1, 'Metal Deck Installation', 'Install metal decking on all floor levels', CURRENT_DATE - 8, CURRENT_DATE + 2, 10, 'in_progress', 'critical', 65, $2),
       ($1, 'Exterior Wall Installation', 'Install exterior wall panels and weather barrier', CURRENT_DATE - 5, CURRENT_DATE + 15, 20, 'in_progress', 'high', 45, $2),
       ($1, 'Roofing Installation', 'Install roofing system and flashing', CURRENT_DATE + 5, CURRENT_DATE + 18, 13, 'not_started', 'high', 0, $2),
       ($1, 'MEP Rough-In', 'Mechanical, electrical, plumbing rough-in all levels', CURRENT_DATE + 10, CURRENT_DATE + 38, 28, 'not_started', 'high', 0, $2),
       ($1, 'Interior Framing & Drywall', 'Frame interior walls, install and finish drywall', CURRENT_DATE + 40, CURRENT_DATE + 68, 28, 'not_started', 'normal', 0, $2),
       ($1, 'Interior Finishes', 'Paint, flooring, millwork, and fixtures', CURRENT_DATE + 70, CURRENT_DATE + 95, 25, 'not_started', 'normal', 0, $2),
       ($1, 'Final MEP Trim & Testing', 'Install fixtures, test all systems, commissioning', CURRENT_DATE + 90, CURRENT_DATE + 105, 15, 'not_started', 'high', 0, $2),
       ($1, 'Final Inspections & Closeout', 'Final inspections, punch list, occupancy permit', CURRENT_DATE + 106, CURRENT_DATE + 115, 9, 'not_started', 'critical', 0, $2)
       RETURNING id`,
      [projectId, demoUserId]
    );
    const taskIds = taskResult.rows.map(r => r.id);

    // Add task dependencies to create critical path
    await client.query(
      `INSERT INTO task_dependencies (predecessor_task_id, successor_task_id, dependency_type, lag_days)
       VALUES
       ($1, $2, 'FS', 0),
       ($2, $3, 'FS', 0),
       ($3, $4, 'SS', 3),
       ($3, $5, 'FS', 0),
       ($5, $6, 'FS', 0),
       ($5, $7, 'FS', 2),
       ($6, $8, 'FS', 3),
       ($7, $8, 'SS', 10),
       ($6, $9, 'FS', 8),
       ($9, $10, 'FS', 2),
       ($10, $11, 'FS', 2),
       ($11, $12, 'FS', 5),
       ($12, $13, 'FS', 0)`,
      [taskIds[0], taskIds[1], taskIds[2], taskIds[3], taskIds[4], taskIds[5], taskIds[6],
       taskIds[7], taskIds[8], taskIds[9], taskIds[10], taskIds[11], taskIds[12]]
    );

    await client.query(
      `INSERT INTO schedule_milestones (project_id, name, description, target_date, status, milestone_type, is_critical, related_task_id, created_by)
       VALUES
       ($1, 'Site Mobilization Complete', 'Temporary facilities ready, utilities connected', CURRENT_DATE - 48, 'achieved', 'phase', false, $2, $3),
       ($1, 'Foundation Complete', 'All foundation work completed and inspected', CURRENT_DATE - 28, 'achieved', 'phase', true, $4, $3),
       ($1, 'Structural Steel Complete', 'Steel frame fully erected and inspected', CURRENT_DATE - 6, 'achieved', 'phase', true, $5, $3),
       ($1, 'Building Dried-In', 'Exterior envelope weather-tight', CURRENT_DATE + 18, 'pending', 'phase', true, $6, $3),
       ($1, 'MEP Rough-In Complete', 'All MEP systems rough-in finished', CURRENT_DATE + 38, 'pending', 'phase', true, $7, $3),
       ($1, 'Interior Finishes Complete', 'All interior finishes installed', CURRENT_DATE + 95, 'pending', 'phase', false, $8, $3),
       ($1, 'Substantial Completion', 'Project substantially complete, ready for final inspection', CURRENT_DATE + 105, 'pending', 'project', true, $9, $3),
       ($1, 'Certificate of Occupancy', 'Final CO received, ready for owner occupancy', CURRENT_DATE + 115, 'pending', 'regulatory', true, $10, $3)`,
      [projectId, taskIds[0], demoUserId, taskIds[2], taskIds[4], taskIds[7], taskIds[8], taskIds[10], taskIds[11], taskIds[12]]
    );
    console.log('   ✓ Created 13 schedule tasks with dependencies & 8 milestones\n');

    // ========================================================================
    // CROSS-MODULE LINKS
    // ========================================================================
    console.log('🔗 Creating cross-module relationships...');

    // Link RFIs to Schedule Tasks (showing RFI impacts schedule)
    await client.query(
      `INSERT INTO schedule_links (task_id, entity_type, entity_id, link_type, schedule_impact_days, created_by)
       VALUES
       ($1, 'rfi', $2, 'blocks', 3, $3),
       ($4, 'rfi', $5, 'blocks', 2, $3)`,
      [taskIds[2], rfiIds[0], demoUserId, taskIds[4], rfiIds[1]]
    );

    // Link Submittals to Schedule Tasks (showing submittal requirements)
    await client.query(
      `INSERT INTO schedule_links (task_id, entity_type, entity_id, link_type, schedule_impact_days, created_by)
       VALUES
       ($1, 'submittal', $2, 'requires', 0, $3),
       ($4, 'submittal', $5, 'requires', 0, $3)`,
      [taskIds[4], submittalIds[0], demoUserId, taskIds[8], submittalIds[3]]
    );

    console.log('   ✓ Linked RFIs and submittals to schedule tasks\n');

    await client.query('COMMIT');

    console.log('✅ Seeding completed successfully!\n');
    console.log('='.repeat(70));
    console.log('📊 DEMO DATA SUMMARY (No Files Required)');
    console.log('='.repeat(70));
    console.log('Login credentials (password: demo123):');
    console.log('  • demo@buildpro.com - John Smith (Project Manager)');
    console.log('  • sarah@buildpro.com - Sarah Johnson (Engineer)');
    console.log('  • mike@buildpro.com - Mike Chen (Superintendent)');
    console.log('  • emily@buildpro.com - Emily Davis (Subcontractor)');
    console.log('');
    console.log('Project: Demo Construction Project');
    console.log('Budget: $5,500,000 | Timeline: 240 days | Status: Active');
    console.log('');
    console.log('📦 Fully Functional Modules:');
    console.log('  ✅ 5 RFIs with 2 detailed responses');
    console.log('  ✅ 3 Submittal Packages with 8 submittals (with review workflow)');
    console.log('  ✅ 5 Daily Logs with weather & detailed manpower tracking');
    console.log('  ✅ 8 Punch Items (various trades and statuses)');
    console.log('  ✅ 12 Budget Lines ($5.5M budgeted, $2.23M committed)');
    console.log('  ✅ 4 Commitments (POs and subcontracts)');
    console.log('  ✅ 3 Change Orders (2 approved, 1 pending)');
    console.log('  ✅ 13 Schedule Tasks with dependencies (critical path)');
    console.log('  ✅ 8 Milestones (3 achieved, 5 pending)');
    console.log('  ✅ Cross-module links (RFIs → Tasks, Submittals → Tasks)');
    console.log('');
    console.log('📝 Note: Documents, Drawings, and Photos modules skipped');
    console.log('   (These require actual file uploads)');
    console.log('='.repeat(70));
    console.log('\n🎉 Log in with demo@buildpro.com / demo123\n');
    console.log('💡 Dashboard will show comprehensive analytics across 8/11 modules!\n');

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
