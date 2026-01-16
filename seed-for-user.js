#!/usr/bin/env node
/**
 * Seed script that creates demo project for an EXISTING user
 *
 * Usage:
 *   node seed-for-user.js your.email@example.com
 *
 * This will create the demo project owned by the specified existing user
 * instead of creating new demo users.
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Get user email from command line
const userEmail = process.argv[2];

if (!userEmail) {
  console.error('❌ Error: Please provide a user email');
  console.error('Usage: node seed-for-user.js your.email@example.com');
  process.exit(1);
}

// Helper to generate mock PDF
async function generateMockPDF(title, content) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
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

// Helper to generate mock image
function generateMockImage(width, height, color) {
  const png = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x64,
    0x08, 0x02, 0x00, 0x00, 0x00, 0xFF, 0x80, 0x02, 0x03
  ]);
  return png;
}

async function seedForExistingUser() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('🌱 Starting database seeding for existing user...\n');

    // Find the existing user
    console.log(`👤 Looking for user: ${userEmail}...`);
    const userResult = await client.query(
      'SELECT id, name, email FROM users WHERE email = $1',
      [userEmail]
    );

    if (userResult.rows.length === 0) {
      throw new Error(`User ${userEmail} not found. Please register first.`);
    }

    const user = userResult.rows[0];
    console.log(`   ✓ Found user: ${user.name} (${user.email})\n`);

    // Check if demo project already exists for this user
    const existingDemo = await client.query(
      "SELECT id FROM projects WHERE name = 'Demo Construction Project' AND owner_id = $1",
      [user.id]
    );

    if (existingDemo.rows.length > 0) {
      console.log('⚠️  Demo project already exists for this user. Skipping seed.');
      await client.query('ROLLBACK');
      return;
    }

    // Create uploads directory
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Create organization if user doesn't have one
    let orgId;
    const orgCheck = await client.query(
      'SELECT id FROM organizations WHERE created_by = $1 LIMIT 1',
      [user.id]
    );

    if (orgCheck.rows.length > 0) {
      orgId = orgCheck.rows[0].id;
      console.log('🏢 Using existing organization\n');
    } else {
      const orgResult = await client.query(
        `INSERT INTO organizations (name, created_by)
         VALUES ($1, $2)
         RETURNING id`,
        [`${user.name}'s Organization`, user.id]
      );
      orgId = orgResult.rows[0].id;
      console.log('🏢 Created new organization\n');
    }

    // Create Demo Project
    console.log('🏗️  Creating demo project...');
    const projectResult = await client.query(
      `INSERT INTO projects (name, description, location, status, start_date, end_date, budget, owner_id, organization_id)
       VALUES (
         'Demo Construction Project',
         'A comprehensive mixed-use development featuring retail, office, and residential spaces. This is a sample project to showcase BuildPro features.',
         '123 Main Street, San Francisco, CA 94102',
         'active',
         CURRENT_DATE - INTERVAL '60 days',
         CURRENT_DATE + INTERVAL '180 days',
         5500000,
         $1,
         $2
       )
       RETURNING id`,
      [user.id, orgId]
    );
    const projectId = projectResult.rows[0].id;
    console.log(`   ✓ Created project: Demo Construction Project\n`);

    // Add user as project manager
    await client.query(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES ($1, $2, 'project_manager')`,
      [projectId, user.id]
    );

    // Create sample documents
    console.log('📄 Creating documents with mock PDFs...');
    const documents = [
      { name: 'Project Plans - Architectural.pdf', category: 'Drawings', size: 2456789 },
      { name: 'Building Permit Application.pdf', category: 'Permits', size: 1234567 },
      { name: 'Safety Plan 2024.pdf', category: 'Safety Documents', size: 987654 },
      { name: 'Contract - General Contractor.pdf', category: 'Contracts', size: 3456789 },
      { name: 'Weekly Progress Report.pdf', category: 'Reports', size: 654321 }
    ];

    for (const doc of documents) {
      const pdfBytes = await generateMockPDF(
        doc.name,
        `This is a sample ${doc.category.toLowerCase()} document.\n\nBuildPro Construction Management System\nGenerated: ${new Date().toLocaleDateString()}`
      );

      const filename = `demo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.pdf`;
      const filePath = path.join(uploadsDir, filename);
      fs.writeFileSync(filePath, pdfBytes);

      await client.query(
        `INSERT INTO documents (project_id, name, category, file_path, file_size, mime_type, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, 'application/pdf', $6)`,
        [projectId, doc.name, doc.category, filePath, doc.size, user.id]
      );
    }
    console.log(`   ✓ Created ${documents.length} documents\n`);

    // Create RFIs
    console.log('📋 Creating RFIs...');
    await client.query(
      `INSERT INTO rfis (project_id, rfi_number, title, question, priority, status, created_by, assigned_to)
       VALUES
         ($1, 'RFI-001', 'Foundation Depth Clarification', 'Please confirm the foundation depth for grid lines A1-A5. Drawings show conflicting dimensions.', 'high', 'open', $2, $2),
         ($1, 'RFI-002', 'Electrical Panel Location', 'Electrical panel location conflicts with mechanical equipment. Need coordination.', 'urgent', 'open', $2, $2),
         ($1, 'RFI-003', 'Window Schedule Revision', 'Window schedule shows discontinued models. Please provide approved alternatives.', 'normal', 'answered', $2, $2)`,
      [projectId, user.id]
    );
    console.log(`   ✓ Created 3 RFIs\n`);

    // Create Schedule Tasks
    console.log('📊 Creating schedule tasks...');
    await client.query(
      `INSERT INTO schedule_tasks (project_id, name, description, wbs_code, planned_start_date, planned_end_date, duration_days, status, priority, created_by)
       VALUES
         ($1, 'Site Preparation', 'Clear and grade site', '1.0', CURRENT_DATE - INTERVAL '50 days', CURRENT_DATE - INTERVAL '43 days', 7, 'completed', 'high', $2),
         ($1, 'Foundation Work', 'Excavate and pour foundation', '1.1', CURRENT_DATE - INTERVAL '42 days', CURRENT_DATE - INTERVAL '28 days', 14, 'completed', 'critical', $2),
         ($1, 'Structural Steel', 'Erect structural steel frame', '2.0', CURRENT_DATE - INTERVAL '27 days', CURRENT_DATE - INTERVAL '6 days', 21, 'completed', 'critical', $2),
         ($1, 'Exterior Walls', 'Install exterior wall panels', '3.0', CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE + INTERVAL '15 days', 20, 'in_progress', 'high', $2),
         ($1, 'MEP Rough-In', 'Mechanical, electrical, plumbing', '4.0', CURRENT_DATE + INTERVAL '10 days', CURRENT_DATE + INTERVAL '38 days', 28, 'not_started', 'high', $2),
         ($1, 'Final Inspections', 'Final building inspections', '7.0', CURRENT_DATE + INTERVAL '80 days', CURRENT_DATE + INTERVAL '90 days', 10, 'not_started', 'critical', $2)`,
      [projectId, user.id]
    );
    console.log(`   ✓ Created 6 schedule tasks\n`);

    // Create Milestones
    console.log('🎯 Creating milestones...');
    await client.query(
      `INSERT INTO schedule_milestones (project_id, name, description, target_date, status, created_by)
       VALUES
         ($1, 'Foundation Complete', 'Foundation work completed', CURRENT_DATE - INTERVAL '28 days', 'achieved', $2),
         ($1, 'Building Dried-In', 'Exterior envelope complete', CURRENT_DATE + INTERVAL '15 days', 'pending', $2),
         ($1, 'Final Completion', 'All work complete', CURRENT_DATE + INTERVAL '90 days', 'pending', $2)`,
      [projectId, user.id]
    );
    console.log(`   ✓ Created 3 milestones\n`);

    // Create Budget Lines
    console.log('💰 Creating financials...');
    await client.query(
      `INSERT INTO budget_lines (project_id, code, description, budget_amount, created_by)
       VALUES
         ($1, '01000', 'General Conditions', 450000, $2),
         ($1, '03000', 'Concrete', 850000, $2),
         ($1, '05000', 'Metals', 1200000, $2),
         ($1, '09000', 'Finishes', 950000, $2),
         ($1, '15000', 'Mechanical', 1100000, $2),
         ($1, '16000', 'Electrical', 950000, $2)`,
      [projectId, user.id]
    );

    await client.query(
      `INSERT INTO commitments (project_id, commitment_number, vendor_name, description, amount, commitment_date, status, created_by)
       VALUES
         ($1, 'CO-001', 'ABC Steel Company', 'Structural steel', 1150000, CURRENT_DATE - INTERVAL '30 days', 'approved', $2),
         ($1, 'CO-002', 'XYZ Concrete', 'Concrete supply', 780000, CURRENT_DATE - INTERVAL '25 days', 'approved', $2)`,
      [projectId, user.id]
    );
    console.log(`   ✓ Created budget lines and commitments\n`);

    // Create Punch Items
    console.log('🔧 Creating punch list...');
    await client.query(
      `INSERT INTO punch_items (project_id, item_number, description, location, priority, status, due_date, created_by, assigned_to)
       VALUES
         ($1, 1, 'Touch up paint on wall', 'Lobby', 'low', 'open', CURRENT_DATE + INTERVAL '14 days', $2, $2),
         ($1, 2, 'Replace cracked floor tile', 'Suite 201', 'medium', 'open', CURRENT_DATE + INTERVAL '7 days', $2, $2),
         ($1, 3, 'Fix leaking faucet', 'Restroom', 'high', 'in_progress', CURRENT_DATE + INTERVAL '3 days', $2, $2)`,
      [projectId, user.id]
    );
    console.log(`   ✓ Created 3 punch items\n`);

    // Create Activity Events
    await client.query(
      `INSERT INTO system_events (project_id, user_id, event_type, entity_type, entity_id, event_data)
       VALUES
         ($1, $2, 'document_upload', 'document', 1, '{"message": "uploaded Project Plans - Architectural.pdf"}'::jsonb),
         ($1, $2, 'rfi_created', 'rfi', 1, '{"message": "created RFI-001: Foundation Depth Clarification"}'::jsonb),
         ($1, $2, 'milestone_achieved', 'milestone', 1, '{"message": "achieved milestone: Foundation Complete"}'::jsonb)`,
      [projectId, user.id]
    );

    await client.query('COMMIT');

    console.log('✅ Database seeding completed successfully!\n');
    console.log('='.repeat(60));
    console.log('📊 SEED DATA SUMMARY');
    console.log('='.repeat(60));
    console.log(`Project: Demo Construction Project (ID: ${projectId})`);
    console.log(`Owner: ${user.name} (${user.email})`);
    console.log(`Budget: $5,500,000`);
    console.log('');
    console.log('Data populated:');
    console.log('  • 5 Documents with mock PDFs');
    console.log('  • 3 RFIs');
    console.log('  • 6 Schedule tasks');
    console.log('  • 3 Milestones');
    console.log('  • 6 Budget lines');
    console.log('  • 2 Commitments');
    console.log('  • 3 Punch items');
    console.log('  • Activity feed populated');
    console.log('='.repeat(60));
    console.log('');
    console.log(`🎉 Login as ${user.email} to see your fully populated demo project!\n`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error seeding database:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedForExistingUser()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
