require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Helper to generate mock PDF
async function generateMockPDF(title, content) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // Letter size
  const { height } = page.getSize();

  page.drawText(title, {
    x: 50,
    y: height - 50,
    size: 20,
    color: rgb(0, 0, 0),
  });

  page.drawText(content, {
    x: 50,
    y: height - 100,
    size: 12,
    color: rgb(0.2, 0.2, 0.2),
  });

  return await pdfDoc.save();
}

// Helper to generate mock image (simple PNG)
function generateMockImage(width, height, color) {
  // Simple PNG header + data (minimal valid PNG)
  const png = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64, // 100x100
    0x08, 0x02, 0x00, 0x00, 0x00, 0xFF, 0x80, 0x02, 0x03
  ]);
  return png;
}

async function seedDatabase() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('🌱 Starting database seeding...\n');

    // Check if demo project already exists
    const existingDemo = await client.query(
      "SELECT id FROM projects WHERE name = 'Demo Construction Project'"
    );

    if (existingDemo.rows.length > 0) {
      console.log('⚠️  Demo project already exists. Skipping seed.');
      console.log('   To re-seed, delete the demo project first.\n');
      await client.query('ROLLBACK');
      return;
    }

    // Create uploads directory if it doesn't exist
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // ========================================================================
    // STEP 1: Create Demo Users
    // ========================================================================
    console.log('👤 Creating demo users...');

    const demoPassword = await bcrypt.hash('demo123', 10);

    const userResult = await client.query(
      `INSERT INTO users (name, email, password, role)
       VALUES
         ('John Smith', 'demo@buildpro.com', $1, 'user'),
         ('Sarah Johnson', 'sarah@buildpro.com', $1, 'user'),
         ('Mike Chen', 'mike@buildpro.com', $1, 'user'),
         ('Emily Davis', 'emily@buildpro.com', $1, 'user')
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name, email`,
      [demoPassword]
    );

    const [demoUser, sarah, mike, emily] = userResult.rows;
    console.log(`   ✓ Created ${userResult.rows.length} users`);
    console.log(`   📧 Demo login: demo@buildpro.com / demo123\n`);

    // ========================================================================
    // STEP 2: Create Demo Organization
    // ========================================================================
    console.log('🏢 Creating demo organization...');

    const orgResult = await client.query(
      `INSERT INTO organizations (name, created_by)
       VALUES ('BuildPro Construction LLC', $1)
       RETURNING id`,
      [demoUser.id]
    );
    const orgId = orgResult.rows[0].id;
    console.log(`   ✓ Created organization\n`);

    // ========================================================================
    // STEP 3: Create Demo Project
    // ========================================================================
    console.log('🏗️  Creating demo project...');

    const projectResult = await client.query(
      `INSERT INTO projects (name, description, location, status, start_date, end_date, budget, owner_id, organization_id)
       VALUES (
         'Demo Construction Project',
         'A comprehensive mixed-use development featuring retail, office, and residential spaces in downtown area. This is a sample project to showcase BuildPro features.',
         '123 Main Street, San Francisco, CA 94102',
         'active',
         CURRENT_DATE - INTERVAL '60 days',
         CURRENT_DATE + INTERVAL '180 days',
         5500000,
         $1,
         $2
       )
       RETURNING id`,
      [demoUser.id, orgId]
    );
    const projectId = projectResult.rows[0].id;
    console.log(`   ✓ Created project: Demo Construction Project\n`);

    // ========================================================================
    // STEP 4: Add Team Members
    // ========================================================================
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

    // ========================================================================
    // STEP 5: Create Documents
    // ========================================================================
    console.log('📄 Creating documents with mock PDFs...');

    const documents = [
      { name: 'Project Plans - Architectural.pdf', category: 'Drawings', size: 2456789 },
      { name: 'Building Permit Application.pdf', category: 'Permits', size: 1234567 },
      { name: 'Safety Plan 2024.pdf', category: 'Safety Documents', size: 987654 },
      { name: 'Contract - General Contractor.pdf', category: 'Contracts', size: 3456789 },
      { name: 'Weekly Progress Report.pdf', category: 'Reports', size: 654321 },
      { name: 'Material Specifications.pdf', category: 'Specifications', size: 2345678 },
      { name: 'Change Order #001.pdf', category: 'Correspondence', size: 456789 }
    ];

    for (const doc of documents) {
      const pdfBytes = await generateMockPDF(
        doc.name,
        `This is a sample ${doc.category.toLowerCase()} document for the demo project.\n\nBuildPro Construction Management System\nGenerated: ${new Date().toLocaleDateString()}`
      );

      const filename = `demo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.pdf`;
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, pdfBytes);

      await client.query(
        `INSERT INTO documents (project_id, name, category, file_path, file_size, mime_type, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, 'application/pdf', $6)`,
        [projectId, doc.name, doc.category, filePath, doc.size, demoUser.id]
      );
    }
    console.log(`   ✓ Created ${documents.length} documents\n`);

    // ========================================================================
    // STEP 6: Create RFIs
    // ========================================================================
    console.log('📋 Creating RFIs with responses...');

    const rfiResult = await client.query(
      `INSERT INTO rfis (project_id, rfi_number, title, question, priority, status, created_by, assigned_to)
       VALUES
         ($1, 'RFI-001', 'Foundation Depth Clarification', 'Please confirm the foundation depth for grid lines A1-A5. Drawings show conflicting dimensions.', 'high', 'open', $2, $3),
         ($1, 'RFI-002', 'Electrical Panel Location', 'Electrical panel location conflicts with mechanical equipment. Need coordination.', 'urgent', 'open', $4, $2),
         ($1, 'RFI-003', 'Window Schedule Revision', 'Window schedule shows discontinued models. Please provide approved alternatives.', 'normal', 'answered', $2, $3),
         ($1, 'RFI-004', 'Concrete Mix Design', 'Confirm concrete mix design for elevated slab - 3000 PSI or 4000 PSI?', 'high', 'answered', $4, $3),
         ($1, 'RFI-005', 'Stair Railing Detail', 'Detail 5/A3.1 is unclear for stair railing attachment. Need clarification.', 'low', 'closed', $2, $3)
       RETURNING id`,
      [projectId, demoUser.id, sarah.id, mike.id]
    );

    // Add responses to some RFIs
    await client.query(
      `INSERT INTO rfi_responses (rfi_id, response, responded_by)
       VALUES
         ($1, 'Foundation depth should be 8 feet below grade per soil report. Drawing A-101 takes precedence.', $2),
         ($2, 'Recommend 4000 PSI for elevated slab to meet structural requirements per spec section 03100.', $2),
         ($3, 'Use 4000 PSI as specified. This has been confirmed with structural engineer.', $3)`,
      [rfiResult.rows[2].id, sarah.id, rfiResult.rows[3].id, sarah.id, rfiResult.rows[4].id, mike.id]
    );

    console.log(`   ✓ Created 5 RFIs with responses\n`);

    // ========================================================================
    // STEP 7: Create Drawing Sets and Sheets
    // ========================================================================
    console.log('📐 Creating drawing sets and sheets...');

    const setResult = await client.query(
      `INSERT INTO drawing_sets (project_id, name, set_number, discipline, created_by)
       VALUES
         ($1, 'Architectural Plans', 'A', 'Architectural', $2),
         ($1, 'Structural Plans', 'S', 'Structural', $2),
         ($1, 'MEP Plans', 'M', 'Mechanical', $2)
       RETURNING id`,
      [projectId, demoUser.id]
    );

    // Create mock PDFs for drawings
    for (let i = 0; i < setResult.rows.length; i++) {
      const setId = setResult.rows[i].id;
      const disciplines = ['Architectural', 'Structural', 'Mechanical'];
      const pdfBytes = await generateMockPDF(
        `${disciplines[i]} Drawing Sheet`,
        `This is a sample ${disciplines[i].toLowerCase()} drawing for the demo project.\n\nSheet 1 of 1\nScale: 1/4" = 1'-0"\nDate: ${new Date().toLocaleDateString()}`
      );

      const filename = `drawing-${Date.now()}-${i}.pdf`;
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, pdfBytes);

      await client.query(
        `INSERT INTO drawing_sheets (drawing_set_id, sheet_number, sheet_name, file_path, file_size, uploaded_by)
         VALUES ($1, $2, $3, $4, 850000, $5)`,
        [setId, `${String.fromCharCode(65 + i)}-101`, `${disciplines[i]} Floor Plan`, filePath, demoUser.id]
      );
    }

    console.log(`   ✓ Created 3 drawing sets with sheets\n`);

    // ========================================================================
    // STEP 8: Create Photo Albums and Photos
    // ========================================================================
    console.log('📸 Creating photo albums and photos...');

    const albumResult = await client.query(
      `INSERT INTO photo_albums (project_id, name, description, created_by)
       VALUES
         ($1, 'Site Progress - Foundation', 'Foundation work progress photos', $2),
         ($1, 'Safety Inspections', 'Weekly safety inspection photos', $2),
         ($1, 'Material Deliveries', 'Photos of material deliveries and storage', $2)
       RETURNING id`,
      [projectId, demoUser.id]
    );

    // Create mock images
    const photoTitles = [
      'Foundation excavation complete',
      'Rebar placement - Grid A',
      'Concrete pour - Section 1',
      'Safety equipment inspection',
      'Steel delivery - Truck 1',
      'Material storage area'
    ];

    for (let i = 0; i < 6; i++) {
      const imgBuffer = generateMockImage(800, 600, 'gray');
      const filename = `photo-${Date.now()}-${i}.png`;
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, imgBuffer);

      const albumId = albumResult.rows[i % 3].id;

      await client.query(
        `INSERT INTO photos (album_id, title, file_path, file_size, mime_type, uploaded_by)
         VALUES ($1, $2, $3, 125000, 'image/png', $4)`,
        [albumId, photoTitles[i], filePath, demoUser.id]
      );
    }

    console.log(`   ✓ Created 3 albums with 6 photos\n`);

    // ========================================================================
    // STEP 9: Create Submittals
    // ========================================================================
    console.log('📤 Creating submittal packages and items...');

    const packageResult = await client.query(
      `INSERT INTO submittal_packages (project_id, package_number, name, spec_section, created_by)
       VALUES
         ($1, 'SUB-001', 'Structural Steel Submittals', '05120', $2),
         ($1, 'SUB-002', 'Mechanical Equipment Submittals', '23000', $2)
       RETURNING id`,
      [projectId, demoUser.id]
    );

    await client.query(
      `INSERT INTO submittals (package_id, submittal_number, description, status, submitted_by, reviewed_by)
       VALUES
         ($1, '001-A', 'Steel beam specifications and mill certs', 'approved', $3, $4),
         ($1, '001-B', 'Connection details and weld procedures', 'approved_as_noted', $3, $4),
         ($2, '002-A', 'HVAC equipment cut sheets', 'pending_review', $3, $4),
         ($2, '002-B', 'Ductwork shop drawings', 'rejected', $3, $4)`,
      [packageResult.rows[0].id, packageResult.rows[1].id, emily.id, sarah.id]
    );

    console.log(`   ✓ Created 2 packages with 4 submittals\n`);

    // ========================================================================
    // STEP 10: Create Daily Logs
    // ========================================================================
    console.log('📅 Creating daily logs...');

    await client.query(
      `INSERT INTO daily_logs (project_id, log_date, weather_conditions, temperature_high, temperature_low, work_performed, delays, safety_incidents, created_by)
       VALUES
         ($1, CURRENT_DATE - INTERVAL '2 days', 'Sunny', 75, 58, 'Continued foundation work. Poured concrete for section A. Steel delivery received and inspected.', 'None', 'None', $2),
         ($1, CURRENT_DATE - INTERVAL '1 day', 'Partly Cloudy', 72, 60, 'Formwork installation for elevated slab. Electrical rough-in started in basement.', 'Delayed 2 hours - crane breakdown', 'None', $2),
         ($1, CURRENT_DATE, 'Clear', 78, 62, 'Concrete pour for elevated slab completed. MEP coordination meeting held on site.', 'None', 'None', $2)`,
      [projectId, mike.id]
    );

    console.log(`   ✓ Created 3 daily logs\n`);

    // ========================================================================
    // STEP 11: Create Punch List Items
    // ========================================================================
    console.log('🔧 Creating punch list items...');

    await client.query(
      `INSERT INTO punch_items (project_id, item_number, description, location, priority, status, due_date, created_by, assigned_to)
       VALUES
         ($1, 1, 'Touch up paint on wall in lobby', 'Level 1 - Lobby', 'low', 'open', CURRENT_DATE + INTERVAL '14 days', $2, $3),
         ($1, 2, 'Replace cracked floor tile', 'Level 2 - Suite 201', 'medium', 'open', CURRENT_DATE + INTERVAL '7 days', $2, $3),
         ($1, 3, 'Fix leaking faucet in restroom', 'Level 1 - Restroom', 'high', 'in_progress', CURRENT_DATE + INTERVAL '3 days', $2, $4),
         ($1, 4, 'Adjust door alignment - sticking', 'Level 3 - Suite 305', 'medium', 'open', CURRENT_DATE + INTERVAL '10 days', $2, $3),
         ($1, 5, 'Clean construction debris from roof', 'Roof Level', 'low', 'completed', CURRENT_DATE - INTERVAL '2 days', $2, $4)`,
      [projectId, mike.id, emily.id, demoUser.id]
    );

    console.log(`   ✓ Created 5 punch items\n`);

    // ========================================================================
    // STEP 12: Create Budget Lines and Financials
    // ========================================================================
    console.log('💰 Creating budget and financial data...');

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

    await client.query(
      `INSERT INTO commitments (project_id, commitment_number, vendor_name, description, amount, commitment_date, status, created_by)
       VALUES
         ($1, 'CO-001', 'ABC Steel Company', 'Structural steel supply and installation', 1150000, CURRENT_DATE - INTERVAL '30 days', 'approved', $2),
         ($1, 'CO-002', 'XYZ Concrete', 'Concrete supply and placement', 780000, CURRENT_DATE - INTERVAL '25 days', 'approved', $2),
         ($1, 'CO-003', 'Elite Mechanical', 'HVAC installation', 980000, CURRENT_DATE - INTERVAL '15 days', 'approved', $2)`,
      [projectId, demoUser.id]
    );

    await client.query(
      `INSERT INTO change_orders (project_id, co_number, description, amount, status, created_by, approved_by)
       VALUES
         ($1, 'CO-001', 'Additional structural support for roof equipment', 45000, 'approved', $2, $3),
         ($1, 'CO-002', 'Upgrade to premium flooring in lobby', 28000, 'pending', $2, NULL)`,
      [projectId, demoUser.id, sarah.id]
    );

    console.log(`   ✓ Created 6 budget lines, 3 commitments, 2 change orders\n`);

    // ========================================================================
    // STEP 13: Create Schedule Tasks and Dependencies
    // ========================================================================
    console.log('📊 Creating schedule tasks and milestones...');

    const taskResult = await client.query(
      `INSERT INTO schedule_tasks (project_id, name, description, wbs_code, planned_start_date, planned_end_date, duration_days, status, priority, created_by)
       VALUES
         ($1, 'Site Preparation', 'Clear and grade site', '1.0', CURRENT_DATE - INTERVAL '50 days', CURRENT_DATE - INTERVAL '43 days', 7, 'completed', 'high', $2),
         ($1, 'Foundation Excavation', 'Excavate for foundation', '1.1', CURRENT_DATE - INTERVAL '42 days', CURRENT_DATE - INTERVAL '35 days', 7, 'completed', 'high', $2),
         ($1, 'Foundation Pour', 'Pour concrete foundation', '1.2', CURRENT_DATE - INTERVAL '34 days', CURRENT_DATE - INTERVAL '27 days', 7, 'completed', 'critical', $2),
         ($1, 'Structural Steel Erection', 'Erect structural steel frame', '2.0', CURRENT_DATE - INTERVAL '26 days', CURRENT_DATE - INTERVAL '12 days', 14, 'completed', 'critical', $2),
         ($1, 'Elevated Slab Pour', 'Pour elevated concrete slabs', '2.1', CURRENT_DATE - INTERVAL '11 days', CURRENT_DATE - INTERVAL '4 days', 7, 'completed', 'high', $2),
         ($1, 'Exterior Walls', 'Install exterior wall panels', '3.0', CURRENT_DATE - INTERVAL '3 days', CURRENT_DATE + INTERVAL '17 days', 20, 'in_progress', 'high', $2),
         ($1, 'Roofing', 'Install roofing system', '3.1', CURRENT_DATE + INTERVAL '5 days', CURRENT_DATE + INTERVAL '19 days', 14, 'not_started', 'medium', $2),
         ($1, 'MEP Rough-In', 'Mechanical, electrical, plumbing rough-in', '4.0', CURRENT_DATE + INTERVAL '10 days', CURRENT_DATE + INTERVAL '38 days', 28, 'not_started', 'high', $2),
         ($1, 'Interior Framing', 'Interior partition framing', '5.0', CURRENT_DATE + INTERVAL '25 days', CURRENT_DATE + INTERVAL '46 days', 21, 'not_started', 'medium', $2),
         ($1, 'Drywall Installation', 'Install and finish drywall', '5.1', CURRENT_DATE + INTERVAL '47 days', CURRENT_DATE + INTERVAL '68 days', 21, 'not_started', 'medium', $2),
         ($1, 'Flooring Installation', 'Install finish flooring', '6.0', CURRENT_DATE + INTERVAL '69 days', CURRENT_DATE + INTERVAL '83 days', 14, 'not_started', 'low', $2),
         ($1, 'Final Inspections', 'Final building inspections', '7.0', CURRENT_DATE + INTERVAL '84 days', CURRENT_DATE + INTERVAL '90 days', 7, 'not_started', 'critical', $2)
       RETURNING id`,
      [projectId, demoUser.id]
    );

    // Create task dependencies
    const tasks = taskResult.rows;
    await client.query(
      `INSERT INTO task_dependencies (successor_task_id, predecessor_task_id, dependency_type, lag_days)
       VALUES
         ($1, $2, 'FS', 0),
         ($3, $1, 'FS', 0),
         ($4, $3, 'FS', 0),
         ($5, $4, 'FS', 0),
         ($6, $5, 'FS', 0),
         ($7, $6, 'FS', 3),
         ($8, $5, 'FS', 7),
         ($9, $6, 'FS', 15),
         ($10, $9, 'FS', 0),
         ($11, $10, 'FS', 0),
         ($12, $11, 'FS', 0)`,
      [
        tasks[1].id, tasks[0].id,
        tasks[2].id, tasks[1].id,
        tasks[3].id, tasks[2].id,
        tasks[4].id, tasks[3].id,
        tasks[5].id, tasks[4].id,
        tasks[6].id, tasks[5].id,
        tasks[7].id, tasks[4].id,
        tasks[8].id, tasks[5].id,
        tasks[9].id, tasks[8].id,
        tasks[10].id, tasks[9].id,
        tasks[11].id, tasks[10].id
      ]
    );

    // Create milestones
    await client.query(
      `INSERT INTO schedule_milestones (project_id, name, description, target_date, status, created_by)
       VALUES
         ($1, 'Foundation Complete', 'Foundation work completed and inspected', CURRENT_DATE - INTERVAL '27 days', 'achieved', $2),
         ($1, 'Structural Frame Complete', 'Steel frame erected and inspected', CURRENT_DATE - INTERVAL '12 days', 'achieved', $2),
         ($1, 'Building Dried-In', 'Exterior envelope complete, weathertight', CURRENT_DATE + INTERVAL '19 days', 'pending', $2),
         ($1, 'MEP Rough-In Complete', 'All MEP systems roughed in', CURRENT_DATE + INTERVAL '38 days', 'pending', $2),
         ($1, 'Substantial Completion', 'Building substantially complete', CURRENT_DATE + INTERVAL '83 days', 'pending', $2),
         ($1, 'Final Completion', 'All work complete, ready for occupancy', CURRENT_DATE + INTERVAL '90 days', 'pending', $2)`,
      [projectId, demoUser.id]
    );

    console.log(`   ✓ Created 12 tasks with dependencies and 6 milestones\n`);

    // ========================================================================
    // STEP 14: Create System Events for Activity Feed
    // ========================================================================
    console.log('📡 Creating activity feed events...');

    await client.query(
      `INSERT INTO system_events (project_id, user_id, event_type, entity_type, entity_id, event_data)
       VALUES
         ($1, $2, 'document_upload', 'document', 1, '{"message": "uploaded Project Plans - Architectural.pdf"}'::jsonb),
         ($1, $3, 'rfi_created', 'rfi', 1, '{"message": "created RFI-001: Foundation Depth Clarification"}'::jsonb),
         ($1, $4, 'task_completed', 'task', 1, '{"message": "completed task: Foundation Pour"}'::jsonb),
         ($1, $2, 'milestone_achieved', 'milestone', 1, '{"message": "achieved milestone: Foundation Complete"}'::jsonb),
         ($1, $3, 'submittal_created', 'submittal', 1, '{"message": "created submittal: Steel beam specifications"}'::jsonb),
         ($1, $4, 'punch_item_created', 'punch_item', 3, '{"message": "created punch item #3: Fix leaking faucet"}'::jsonb),
         ($1, $2, 'document_upload', 'document', 2, '{"message": "uploaded Building Permit Application.pdf"}'::jsonb),
         ($1, $3, 'daily_log_created', 'daily_log', 1, jsonb_build_object('message', 'created daily log for ' || TO_CHAR(CURRENT_DATE - INTERVAL '2 days', 'Mon DD, YYYY')))`,
      [projectId, demoUser.id, sarah.id, mike.id]
    );

    console.log(`   ✓ Created activity feed events\n`);

    await client.query('COMMIT');

    console.log('✅ Database seeding completed successfully!\n');
    console.log('=' . repeat(60));
    console.log('📊 SEED DATA SUMMARY');
    console.log('=' . repeat(60));
    console.log(`Project: Demo Construction Project (ID: ${projectId})`);
    console.log(`Location: 123 Main Street, San Francisco, CA 94102`);
    console.log(`Budget: $5,500,000`);
    console.log('');
    console.log('Users created:');
    console.log('  • demo@buildpro.com (Password: demo123) - Project Manager');
    console.log('  • sarah@buildpro.com (Password: demo123) - Engineer');
    console.log('  • mike@buildpro.com (Password: demo123) - Superintendent');
    console.log('  • emily@buildpro.com (Password: demo123) - Subcontractor');
    console.log('');
    console.log('Data populated:');
    console.log('  • 7 Documents with mock PDFs');
    console.log('  • 5 RFIs with responses');
    console.log('  • 3 Drawing sets with sheets');
    console.log('  • 3 Photo albums with 6 photos');
    console.log('  • 2 Submittal packages with 4 items');
    console.log('  • 3 Daily logs');
    console.log('  • 5 Punch list items');
    console.log('  • 6 Budget lines');
    console.log('  • 3 Commitments');
    console.log('  • 2 Change orders');
    console.log('  • 12 Schedule tasks with dependencies');
    console.log('  • 6 Milestones');
    console.log('  • Activity feed populated');
    console.log('=' . repeat(60));
    console.log('');
    console.log('🎉 You can now log in with demo@buildpro.com to see the fully populated project!\n');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error seeding database:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the seed function
seedDatabase()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
